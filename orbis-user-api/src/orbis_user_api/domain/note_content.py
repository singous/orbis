from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

EMPTY_NOTE_BLOCKS: dict[str, Any] = {
    "schema_version": 1,
    "editor": "tiptap",
    "doc": {"type": "doc", "content": [{"type": "paragraph"}]},
}

BLOCK_TYPES = {
    "doc",
    "heading",
    "paragraph",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
    "blockquote",
    "codeBlock",
    "horizontalRule",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
    "text",
}
MARK_TYPES = {"bold", "italic", "strike", "code", "link"}


class InvalidNoteContent(ValueError):
    pass


def empty_note_blocks() -> dict[str, Any]:
    return deepcopy(EMPTY_NOTE_BLOCKS)


def _validate_marks(marks: object) -> None:
    if not isinstance(marks, list):
        raise InvalidNoteContent
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("type") not in MARK_TYPES:
            raise InvalidNoteContent
        if mark["type"] == "link":
            attrs = mark.get("attrs")
            if not isinstance(attrs, dict) or not isinstance(attrs.get("href"), str):
                raise InvalidNoteContent


def _validate_node(node: object, parent_type: str | None = None) -> None:
    if not isinstance(node, dict):
        raise InvalidNoteContent
    node_type = node.get("type")
    if node_type not in BLOCK_TYPES:
        raise InvalidNoteContent
    if parent_type is None and node_type != "doc":
        raise InvalidNoteContent

    attrs = node.get("attrs")
    if attrs is not None and not isinstance(attrs, dict):
        raise InvalidNoteContent
    if node_type == "heading":
        level = (attrs or {}).get("level")
        if not isinstance(level, int) or isinstance(level, bool) or not 1 <= level <= 6:
            raise InvalidNoteContent
    if node_type == "taskItem" and not isinstance((attrs or {}).get("checked"), bool):
        raise InvalidNoteContent

    if node_type == "text":
        if not isinstance(node.get("text"), str) or "content" in node:
            raise InvalidNoteContent
        if "marks" in node:
            _validate_marks(node["marks"])
        return

    content = node.get("content", [])
    if not isinstance(content, list):
        raise InvalidNoteContent
    allowed_children = {
        "doc": {
            "heading",
            "paragraph",
            "bulletList",
            "orderedList",
            "taskList",
            "blockquote",
            "codeBlock",
            "horizontalRule",
            "table",
        },
        "heading": {"text"},
        "paragraph": {"text"},
        "bulletList": {"listItem"},
        "orderedList": {"listItem"},
        "listItem": {
            "paragraph",
            "bulletList",
            "orderedList",
            "taskList",
            "blockquote",
        },
        "taskList": {"taskItem"},
        "taskItem": {"paragraph", "bulletList", "orderedList", "taskList"},
        "blockquote": {
            "heading",
            "paragraph",
            "bulletList",
            "orderedList",
            "taskList",
            "codeBlock",
        },
        "codeBlock": {"text"},
        "horizontalRule": set(),
        "table": {"tableRow"},
        "tableRow": {"tableCell", "tableHeader"},
        "tableCell": {"paragraph", "heading", "bulletList", "orderedList"},
        "tableHeader": {"paragraph", "heading"},
    }[node_type]
    for child in content:
        if not isinstance(child, dict) or child.get("type") not in allowed_children:
            raise InvalidNoteContent
        _validate_node(child, node_type)


def normalize_note_blocks(blocks: object) -> dict[str, Any]:
    if not isinstance(blocks, dict):
        raise InvalidNoteContent
    if blocks.get("schema_version") != 1 or blocks.get("editor") != "tiptap":
        raise InvalidNoteContent
    doc = blocks.get("doc")
    _validate_node(doc)
    return deepcopy({"schema_version": 1, "editor": "tiptap", "doc": doc})


def _node_text(node: dict[str, Any]) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_node_text(child) for child in node.get("content", []))


def derive_plain_text(blocks: dict[str, Any]) -> str:
    lines: list[str] = []

    def visit(node: dict[str, Any]) -> None:
        node_type = node["type"]
        if node_type in {"heading", "paragraph", "codeBlock"}:
            text = _node_text(node).strip()
            if text:
                lines.append(text)
            return
        if node_type == "tableRow":
            row = "\t".join(
                _node_text(cell).strip() for cell in node.get("content", [])
            )
            if row.strip():
                lines.append(row)
            return
        for child in node.get("content", []):
            visit(child)

    visit(blocks["doc"])
    return "\n".join(lines)


_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _inline_content(text: str) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    cursor = 0
    for match in _LINK_RE.finditer(text):
        if match.start() > cursor:
            content.append({"type": "text", "text": text[cursor : match.start()]})
        content.append(
            {
                "type": "text",
                "text": match.group(1),
                "marks": [{"type": "link", "attrs": {"href": match.group(2)}}],
            }
        )
        cursor = match.end()
    if cursor < len(text):
        content.append({"type": "text", "text": text[cursor:]})
    return content


def _paragraph(text: str) -> dict[str, Any]:
    content = _inline_content(text)
    return {"type": "paragraph", **({"content": content} if content else {})}


def _is_table_separator(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def markdown_to_blocks(markdown: str) -> dict[str, Any]:
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    nodes: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            index += 1
            continue
        if stripped.startswith("```"):
            language = stripped[3:].strip() or None
            index += 1
            code_lines: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            if index >= len(lines):
                raise InvalidNoteContent("Unclosed fenced code block")
            index += 1
            text = "\n".join(code_lines)
            nodes.append(
                {
                    "type": "codeBlock",
                    "attrs": {"language": language},
                    **({"content": [{"type": "text", "text": text}]} if text else {}),
                }
            )
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            nodes.append(
                {
                    "type": "heading",
                    "attrs": {"level": len(heading.group(1))},
                    "content": _inline_content(heading.group(2)),
                }
            )
            index += 1
            continue
        if re.fullmatch(r"(?:-{3,}|\*{3,}|_{3,})", stripped):
            nodes.append({"type": "horizontalRule"})
            index += 1
            continue
        if (
            index + 1 < len(lines)
            and "|" in line
            and _is_table_separator(lines[index + 1])
        ):
            header = [cell.strip() for cell in line.strip().strip("|").split("|")]
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(
                    [
                        cell.strip()
                        for cell in lines[index].strip().strip("|").split("|")
                    ]
                )
                index += 1

            def row_node(cells: list[str], cell_type: str) -> dict[str, Any]:
                return {
                    "type": "tableRow",
                    "content": [
                        {"type": cell_type, "content": [_paragraph(cell)]}
                        for cell in cells
                    ],
                }

            nodes.append(
                {
                    "type": "table",
                    "content": [row_node(header, "tableHeader")]
                    + [row_node(row, "tableCell") for row in rows],
                }
            )
            continue
        if stripped.startswith(">"):
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip()[1:].lstrip())
                index += 1
            quoted = markdown_to_blocks("\n".join(quote_lines))["doc"]["content"]
            nodes.append({"type": "blockquote", "content": quoted or [_paragraph("")]})
            continue
        task = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.+)$", stripped)
        if task:
            items: list[dict[str, Any]] = []
            while index < len(lines):
                item = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.+)$", lines[index].strip())
                if item is None:
                    break
                items.append(
                    {
                        "type": "taskItem",
                        "attrs": {"checked": item.group(1).lower() == "x"},
                        "content": [_paragraph(item.group(2))],
                    }
                )
                index += 1
            nodes.append({"type": "taskList", "content": items})
            continue
        bullet = re.match(r"^[-*+]\s+(.+)$", stripped)
        if bullet:
            items = []
            while index < len(lines):
                item = re.match(r"^[-*+]\s+(.+)$", lines[index].strip())
                if item is None or re.match(r"^\[[ xX]\]\s+", item.group(1)):
                    break
                items.append(
                    {"type": "listItem", "content": [_paragraph(item.group(1))]}
                )
                index += 1
            nodes.append({"type": "bulletList", "content": items})
            continue
        ordered = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if ordered:
            items = []
            while index < len(lines):
                item = re.match(r"^\d+[.)]\s+(.+)$", lines[index].strip())
                if item is None:
                    break
                items.append(
                    {"type": "listItem", "content": [_paragraph(item.group(1))]}
                )
                index += 1
            nodes.append({"type": "orderedList", "content": items})
            continue

        paragraph_lines = [stripped]
        index += 1
        while index < len(lines) and lines[index].strip():
            next_line = lines[index].strip()
            if (
                next_line.startswith(("#", ">", "```"))
                or re.match(r"^[-*+]\s+", next_line)
                or re.match(r"^\d+[.)]\s+", next_line)
            ):
                break
            paragraph_lines.append(next_line)
            index += 1
        nodes.append(_paragraph(" ".join(paragraph_lines)))

    return normalize_note_blocks(
        {
            "schema_version": 1,
            "editor": "tiptap",
            "doc": {"type": "doc", "content": nodes or [{"type": "paragraph"}]},
        }
    )


def _render_inline(nodes: list[dict[str, Any]]) -> str:
    rendered: list[str] = []
    for node in nodes:
        value = node.get("text", "")
        for mark in node.get("marks", []):
            mark_type = mark["type"]
            if mark_type == "link":
                value = f"[{value}]({mark['attrs']['href']})"
            elif mark_type == "bold":
                value = f"**{value}**"
            elif mark_type == "italic":
                value = f"*{value}*"
            elif mark_type == "strike":
                value = f"~~{value}~~"
            elif mark_type == "code":
                value = f"`{value}`"
        rendered.append(value)
    return "".join(rendered)


def _render_blocks(nodes: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for node in nodes:
        node_type = node["type"]
        if node_type == "paragraph":
            blocks.append(_render_inline(node.get("content", [])))
        elif node_type == "heading":
            blocks.append(
                f"{'#' * node['attrs']['level']} {_render_inline(node.get('content', []))}"
            )
        elif node_type in {"bulletList", "orderedList"}:
            prefix = "-" if node_type == "bulletList" else None
            blocks.append(
                "\n".join(
                    f"{prefix or f'{position}.'} {_render_blocks(item.get('content', [])).replace(chr(10), ' ')}"
                    for position, item in enumerate(node.get("content", []), start=1)
                )
            )
        elif node_type == "taskList":
            blocks.append(
                "\n".join(
                    f"- [{'x' if item.get('attrs', {}).get('checked') else ' '}] "
                    f"{_render_blocks(item.get('content', [])).replace(chr(10), ' ')}"
                    for item in node.get("content", [])
                )
            )
        elif node_type == "blockquote":
            blocks.append(
                "\n".join(
                    f"> {line}"
                    for line in _render_blocks(node.get("content", [])).splitlines()
                )
            )
        elif node_type == "codeBlock":
            blocks.append(
                f"```{node.get('attrs', {}).get('language') or ''}\n{_node_text(node)}\n```"
            )
        elif node_type == "horizontalRule":
            blocks.append("---")
        elif node_type == "table":
            rows = [
                [
                    _node_text(cell).replace("|", "\\|")
                    for cell in row.get("content", [])
                ]
                for row in node.get("content", [])
            ]
            if rows:
                width = max(len(row) for row in rows)
                rows = [row + [""] * (width - len(row)) for row in rows]
                blocks.append(
                    "\n".join(
                        [
                            f"| {' | '.join(rows[0])} |",
                            f"| {' | '.join('---' for _ in range(width))} |",
                        ]
                        + [f"| {' | '.join(row)} |" for row in rows[1:]]
                    )
                )
    return "\n\n".join(block for block in blocks if block)


def blocks_to_markdown(blocks: dict[str, Any]) -> str:
    canonical = normalize_note_blocks(blocks)
    return _render_blocks(canonical["doc"].get("content", [])).strip()
