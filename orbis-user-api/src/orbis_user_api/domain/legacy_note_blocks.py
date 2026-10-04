from __future__ import annotations

from typing import Any
from uuid import UUID

from orbis_user_api.domain.note_content import InvalidNoteContent


def _inline(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for node in nodes:
        if node.get("type") != "text":
            continue
        styles = {
            mark["type"]: True
            for mark in node.get("marks", [])
            if mark.get("type") in {"bold", "italic", "underline", "strike", "code"}
        }
        value = {"type": "text", "text": node.get("text", ""), "styles": styles}
        link = next(
            (
                mark.get("attrs", {}).get("href")
                for mark in node.get("marks", [])
                if mark.get("type") == "link"
            ),
            None,
        )
        output.append(
            {"type": "link", "href": link, "content": [value]} if link else value
        )
    return output


def _cell_inline(node: dict[str, Any]) -> list[dict[str, Any]]:
    if node.get("type") in {"paragraph", "heading"}:
        return _inline(node.get("content", []))
    output = []
    for index, child in enumerate(node.get("content", [])):
        if index:
            output.append({"type": "text", "text": "\n"})
        if node.get("type") in {"bulletList", "orderedList"}:
            start = node.get("attrs", {}).get("start", 1)
            output.append(
                {
                    "type": "text",
                    "text": "- "
                    if node["type"] == "bulletList"
                    else f"{index + start}. ",
                }
            )
        output.extend(_cell_inline(child))
    return output


def _table(node: dict[str, Any]) -> dict[str, Any]:
    rows = node.get("content", [])
    header_rows = 0
    for row in rows:
        cells = row.get("content", [])
        if not cells or not all(cell["type"] == "tableHeader" for cell in cells):
            break
        header_rows += 1
    leading_headers = []
    for row in rows:
        count = 0
        for cell in row.get("content", []):
            if cell["type"] != "tableHeader":
                break
            count += cell.get("attrs", {}).get("colspan", 1)
        leading_headers.append(count)
    widths = []
    for cell in rows[0].get("content", []) if rows else []:
        attrs = cell.get("attrs", {})
        declared = attrs.get("colwidth") or []
        widths.extend(
            declared[index] if index < len(declared) else None
            for index in range(attrs.get("colspan", 1))
        )
    return {
        "type": "tableContent",
        "columnWidths": widths,
        "headerRows": header_rows,
        "headerCols": min(leading_headers, default=0),
        "rows": [
            {
                "cells": [
                    {
                        "type": "tableCell",
                        "props": {
                            "colspan": cell.get("attrs", {}).get("colspan", 1),
                            "rowspan": cell.get("attrs", {}).get("rowspan", 1),
                        },
                        "content": _cell_inline(cell),
                    }
                    for cell in row.get("content", [])
                ]
            }
            for row in rows
        ],
    }


def _convert(node: dict[str, Any]) -> list[dict[str, Any]]:
    kind = node.get("type")
    props: dict[str, Any] = {}
    content: Any = _inline(node.get("content", []))
    children: list[dict[str, Any]] = []
    if kind in {"bulletList", "orderedList", "taskList"}:
        output = []
        for index, item in enumerate(node.get("content", [])):
            parts = item.get("content", [])
            item_props = (
                {"checked": bool(item.get("attrs", {}).get("checked"))}
                if kind == "taskList"
                else {}
            )
            if kind == "orderedList" and index == 0:
                item_props["start"] = node.get("attrs", {}).get("start", 1)
            output.append(
                {
                    "type": {
                        "bulletList": "bulletListItem",
                        "orderedList": "numberedListItem",
                        "taskList": "checkListItem",
                    }[kind],
                    "props": item_props,
                    "content": _inline(parts[0].get("content", []))
                    if parts and parts[0]["type"] == "paragraph"
                    else [],
                    "children": [
                        block for child in parts[1:] for block in _convert(child)
                    ],
                }
            )
        return output
    if kind == "heading":
        props = {"level": node.get("attrs", {}).get("level", 1)}
    elif kind == "blockquote":
        kind = "quote"
        content = []
        children = [
            block for child in node.get("content", []) for block in _convert(child)
        ]
    elif kind == "codeBlock":
        props = {"language": node.get("attrs", {}).get("language") or "none"}
        content = "".join(child.get("text", "") for child in node.get("content", []))
    elif kind == "horizontalRule":
        kind, content = "divider", []
    elif kind == "table":
        content = _table(node)
    elif kind != "paragraph":
        kind = "paragraph"
    return [{"type": kind, "props": props, "content": content, "children": children}]


def editable_note_blocks(note_id: UUID, blocks: dict[str, Any]) -> dict[str, Any]:
    """Match the existing editor's legacy conversion and deterministic identities.

    Reading only projects an editable representation; storage is not migrated.
    """
    if blocks.get("schema_version") == 2:
        return blocks
    if (
        blocks.get("schema_version") != 1
        or blocks.get("editor") != "tiptap"
        or not isinstance(blocks.get("doc"), dict)
    ):
        raise InvalidNoteContent
    roots = [
        block
        for node in blocks.get("doc", {}).get("content", [])
        for block in _convert(node)
    ]
    if not roots:
        roots = [{"type": "paragraph", "props": {}, "content": [], "children": []}]

    def assign(siblings: list[dict[str, Any]], parent: list[int]) -> None:
        for index, block in enumerate(siblings):
            path = [*parent, index]
            block["id"] = f"legacy-{note_id}-" + "-".join(map(str, path))
            assign(block["children"], path)

    assign(roots, [])
    return {"schema_version": 2, "editor": "blocknote", "blocks": roots}
