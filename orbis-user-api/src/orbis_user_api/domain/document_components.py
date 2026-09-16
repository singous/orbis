"""Shared declarative document components; never evaluate embedded code."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

DOCUMENT_BLOCKS: dict[str, dict[str, Any]] = json.loads(
    Path(__file__).with_name("document_blocks.json").read_text(encoding="utf-8")
)["blocks"]


def validate_component(block: dict[str, Any]) -> None:
    definition = DOCUMENT_BLOCKS.get(block["type"])
    if definition is None:
        return
    props = block.get("props", {})
    for name, rule in definition["props"].items():
        value = props.get(name, rule["default"])
        if type(value) is not type(rule["default"]):
            raise ValueError(f"Invalid component property type: {block['type']}.{name}")
        if "values" in rule and value not in rule["values"]:
            raise ValueError(f"Unsupported component property: {block['type']}.{name}")
        if isinstance(value, str) and len(value) > rule.get("maxLength", 2048):
            raise ValueError(f"Component property is too long: {block['type']}.{name}")
    if definition["content"] == "none" and block.get("content", []) not in ([], ""):
        raise ValueError("Container components store their body in child blocks")
    allowed = definition["children"]
    if allowed != "any" and any(
        child.get("type") not in allowed for child in block.get("children", [])
    ):
        raise ValueError(f"Unsupported child in {block['type']}")


def apply_component_defaults(block: dict[str, Any]) -> None:
    definition = DOCUMENT_BLOCKS.get(block["type"])
    if definition:
        props = block.setdefault("props", {})
        for name, rule in definition["props"].items():
            props.setdefault(name, rule["default"])
    for child in block.get("children", []):
        apply_component_defaults(child)


def component_title(block: dict[str, Any]) -> str:
    definition = DOCUMENT_BLOCKS.get(block["type"])
    if not definition or "title" not in definition["props"]:
        return ""
    return block.get("props", {}).get("title", definition["props"]["title"]["default"])


def _markdown_title(value: str) -> str:
    for char in ("\\", "*", "_", "[", "]"):
        value = value.replace(char, "\\" + char)
    return value.replace("\n", " ")


def component_markdown(
    block: dict[str, Any],
    inline: str,
    render: Callable[[list[dict[str, Any]]], str],
) -> str | None:
    kind = block["type"]
    if kind not in DOCUMENT_BLOCKS:
        return None
    title = _markdown_title(component_title(block))
    children = block.get("children", [])
    if kind == "callout":
        body = "\n\n".join(
            part
            for part in [f"**{title}**" if title else "", inline, render(children)]
            if part
        )
        return "\n".join("> " + line if line else ">" for line in body.split("\n"))
    if kind in {"card", "step", "tab"}:
        href = block.get("props", {}).get("href") if kind == "card" else None
        heading = f"### [{title}]({href})" if href else f"### {title}"
        return "\n\n".join(part for part in [heading, inline, render(children)] if part)
    if kind == "steps":
        parts = []
        for index, child in enumerate(children, 1):
            marker = f"{index}. "
            heading = marker + "**" + _markdown_title(component_title(child)) + "**"
            body = render(child.get("children", []))
            indented = "\n".join(
                " " * len(marker) + line if line else "" for line in body.split("\n")
            )
            parts.append(heading + ("\n\n" + indented if body else ""))
        return "\n\n".join(parts)
    return render(children)
