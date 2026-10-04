"""Markdown inline codec shared by legacy marks and normalized block styles."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from markdown_it import MarkdownIt

from orbis_user_api.domain.markdown_urls import markdown_destination

TOKEN_MARKS = {"strong": "bold", "em": "italic", "s": "strike"}
STYLE_ORDER = ("bold", "italic", "strike")
TEXT_CONTROLS = re.compile(r"([\\`*\[\]~<>])")


@lru_cache(maxsize=1)
def _parser() -> MarkdownIt:
    parser = MarkdownIt("commonmark", {"html": False}).enable("strikethrough")
    # Storage has always accepted custom references and arbitrary URL schemes.
    # Rendering, attachment authorization, and public delivery enforce safety.
    parser.validateLink = lambda _value: True
    parser.normalizeLink = lambda value: value
    return parser


def parse_inline(source: str) -> list[dict[str, Any]]:
    """Return Tiptap text nodes; unsupported inline HTML remains literal text."""
    result: list[dict[str, Any]] = []
    marks: list[dict[str, Any]] = []

    def append(value: str, extra: list[dict[str, Any]] | None = None) -> None:
        if not value:
            return
        active = [*marks, *(extra or [])]
        if result and result[-1].get("marks", []) == active:
            result[-1]["text"] += value
        else:
            result.append(
                {
                    "type": "text",
                    "text": value,
                    **({"marks": active.copy()} if active else {}),
                }
            )

    for token in _parser().parseInline(source)[0].children or []:
        kind = token.type.removesuffix("_open").removesuffix("_close")
        if token.nesting == 1 and kind in TOKEN_MARKS:
            marks.append({"type": TOKEN_MARKS[kind]})
        elif token.type == "link_open":
            marks.append(
                {"type": "link", "attrs": {"href": token.attrGet("href") or ""}}
            )
        elif token.nesting == -1 and (kind in TOKEN_MARKS or kind == "link"):
            if marks:
                marks.pop()
        elif token.type == "code_inline":
            append(token.content, [{"type": "code"}])
        elif token.type in {"softbreak", "hardbreak"}:
            append("\n")
        elif token.type == "image":
            # Inline images have no supported text-node representation. Keep
            # their visible source rather than dropping the URL or alt text.
            destination = markdown_destination(token.attrGet("src") or "")
            append(f"![{token.content}]({destination})")
        else:
            append(token.content)
    return result


def escape_text(value: str) -> str:
    def underscore(match: re.Match[str]) -> str:
        left = value[match.start() - 1] if match.start() else ""
        right = value[match.end()] if match.end() < len(value) else ""
        return (
            match.group()
            if left.isalnum() and right.isalnum()
            else "\\_" * len(match.group())
        )

    # CommonMark cannot emphasize underscores inside a word. Retain those
    # familiar identifiers in text exports rather than adding needless escapes.
    escaped = TEXT_CONTROLS.sub(r"\\\1", value)
    # Evaluate boundaries against the escaped string's own offsets.
    value = escaped
    escaped = re.sub(r"_+", underscore, escaped)
    return re.sub(r"&(?=(?:#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);)", r"\\&", escaped)


def _code_span(value: str) -> str:
    longest = max((len(run) for run in re.findall(r"`+", value)), default=0)
    fence = "`" * (longest + 1)
    needs_padding = (
        value.startswith("`")
        or value.endswith("`")
        or (value.startswith(" ") and value.endswith(" ") and value.strip(" "))
    )
    body = f" {value} " if needs_padding else value
    return f"{fence}{body}{fence}"


def render_text(
    value: str, styles: dict[str, Any] | None = None, href: str | None = None
) -> str:
    style = styles or {}
    marks = [{"type": name} for name in (*STYLE_ORDER, "code") if style.get(name)]
    if href is not None:
        marks.insert(0, {"type": "link", "attrs": {"href": href}})
    return render_legacy_inline([{"type": "text", "text": value, "marks": marks}])


def render_legacy_inline(nodes: list[dict[str, Any]]) -> str:
    rendered: list[str] = []
    active: list[dict[str, Any]] = []
    coalesced: list[dict[str, Any]] = []
    for node in nodes:
        if not node.get("text", ""):
            continue
        if coalesced and coalesced[-1].get("marks", []) == node.get("marks", []):
            coalesced[-1]["text"] += node.get("text", "")
        else:
            coalesced.append({**node, "text": node.get("text", "")})

    def delimiter(mark: dict[str, Any], closing: bool) -> str:
        if mark["type"] == "link":
            return (
                f"]({markdown_destination(mark['attrs']['href'])})" if closing else "["
            )
        return {"bold": "**", "italic": "*", "strike": "~~"}[mark["type"]]

    for node in coalesced:
        marks = node.get("marks", [])
        target = [mark for mark in marks if mark.get("type") in {*STYLE_ORDER, "link"}]
        # Stored marks commute. Retain a shared outer mark when a new inner
        # style appears so adjacent delimiter runs keep their intended meaning.
        retained: list[dict[str, Any]] = []
        for mark in active:
            if mark not in target:
                break
            retained.append(mark)
        target = [*retained, *(mark for mark in target if mark not in retained)]
        common = 0
        while (
            common < min(len(active), len(target)) and active[common] == target[common]
        ):
            common += 1
        rendered.extend(delimiter(mark, True) for mark in reversed(active[common:]))
        rendered.extend(delimiter(mark, False) for mark in target[common:])
        rendered.append(
            _code_span(node["text"])
            if any(mark.get("type") == "code" for mark in marks)
            else escape_text(node["text"])
        )
        active = target
    rendered.extend(delimiter(mark, True) for mark in reversed(active))
    return "".join(rendered)


def render_normalized_inline(value: object) -> str:
    nodes: list[dict[str, Any]] = []

    def collect(item: object, parents: list[dict[str, Any]]) -> None:
        if isinstance(item, list):
            for child in item:
                collect(child, parents)
        elif isinstance(item, str):
            nodes.append({"type": "text", "text": item, "marks": parents})
        elif isinstance(item, dict) and item.get("type") == "link":
            collect(
                item.get("content", []),
                [*parents, {"type": "link", "attrs": {"href": item.get("href", "")}}],
            )
        elif isinstance(item, dict):
            styles = item.get("styles") or {}
            marks = [
                *parents,
                *(
                    {"type": name}
                    for name in (*STYLE_ORDER, "code")
                    if styles.get(name)
                ),
            ]
            nodes.append({"type": "text", "text": item.get("text", ""), "marks": marks})

    collect(value, [])
    return render_legacy_inline(nodes)
