from __future__ import annotations

from typing import Any

from orbis_user_api.application.site_errors import unsafe_site_content
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.domain.note_content import InvalidNoteContent, normalize_note_blocks

MEDIA_TYPES = frozenset({"image", "file", "audio", "video"})
PUBLIC_TEXT_STYLES = frozenset(
    {"bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"}
)
PUBLIC_BLOCK_PROPS = frozenset(
    {
        "textAlignment",
        "textColor",
        "backgroundColor",
        "level",
        "checked",
        "language",
        "name",
        "caption",
        "previewWidth",
        "showPreview",
        "start",
        "isToggleable",
    }
)
V1_ATTRIBUTES = {
    "heading": {"level"},
    "taskItem": {"checked"},
    "codeBlock": {"language"},
    "orderedList": {"start"},
    "tableCell": {"colspan", "rowspan", "colwidth"},
    "tableHeader": {"colspan", "rowspan", "colwidth"},
}


def _public_v1(node: dict[str, Any], policy: PublicUrlPolicy) -> dict[str, Any]:
    result: dict[str, Any] = {"type": node["type"]}
    if node["type"] == "text":
        result["text"] = node["text"]
        marks = []
        for mark in node.get("marks", []):
            item: dict[str, Any] = {"type": mark["type"]}
            if mark["type"] == "link":
                item["attrs"] = {"href": policy.validate(mark["attrs"]["href"])}
            marks.append(item)
        if marks:
            result["marks"] = marks
    if "content" in node:
        result["content"] = [_public_v1(child, policy) for child in node["content"]]
    attrs = node.get("attrs") or {}
    allowed = V1_ATTRIBUTES.get(node["type"], set())
    projected_attrs = {
        key: value
        for key, value in attrs.items()
        if key in allowed
        and (
            value is None
            or isinstance(value, (str, int, bool))
            or (
                key == "colwidth"
                and isinstance(value, list)
                and all(isinstance(item, int) for item in value)
            )
        )
    }
    if projected_attrs:
        result["attrs"] = projected_attrs
    return result


def _public_inline(content: Any, policy: PublicUrlPolicy) -> Any:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return [_public_inline(item, policy) for item in content]
    if not isinstance(content, dict):
        raise unsafe_site_content()
    if content.get("type") == "text" and isinstance(content.get("text"), str):
        styles = content.get("styles", {})
        if not isinstance(styles, dict):
            raise unsafe_site_content()
        return {
            "type": "text",
            "text": content["text"],
            "styles": {
                key: value
                for key, value in styles.items()
                if key in PUBLIC_TEXT_STYLES and isinstance(value, (bool, str))
            },
        }
    if content.get("type") == "link":
        children = content.get("content", [])
        if not isinstance(children, (str, list)):
            raise unsafe_site_content()
        return {
            "type": "link",
            "href": policy.validate(content.get("href")),
            "content": _public_inline(children, policy),
        }
    if content.get("type") == "tableCell":
        result = {
            "type": "tableCell",
            "content": _public_inline(content.get("content", []), policy),
        }
        props = content.get("props", {})
        if not isinstance(props, dict):
            raise unsafe_site_content()
        result["props"] = {
            key: value
            for key, value in props.items()
            if key
            in {"textAlignment", "textColor", "backgroundColor", "colspan", "rowspan"}
            and isinstance(value, (str, int))
        }
        return result
    raise unsafe_site_content()


def _public_table(content: Any, policy: PublicUrlPolicy) -> Any:
    if isinstance(content, list):
        return _public_inline(content, policy)
    if not isinstance(content, dict) or content.get("type") != "tableContent":
        raise unsafe_site_content()
    rows = content.get("rows")
    if not isinstance(rows, list):
        raise unsafe_site_content()
    result: dict[str, Any] = {"type": "tableContent", "rows": []}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("cells"), list):
            raise unsafe_site_content()
        result["rows"].append(
            {"cells": [_public_inline(cell, policy) for cell in row["cells"]]}
        )
    for key in ("headerRows", "headerCols"):
        if key in content and isinstance(content[key], int):
            result[key] = content[key]
    widths = content.get("columnWidths")
    if isinstance(widths, list) and all(
        value is None or isinstance(value, (int, float)) for value in widths
    ):
        result["columnWidths"] = widths
    return result


def _public_v2(
    block: dict[str, Any], path: str, policy: PublicUrlPolicy
) -> dict[str, Any]:
    props = block.get("props", {})
    result: dict[str, Any] = {
        "id": f"public-{path}",
        "type": block["type"],
        "props": {
            key: value
            for key, value in props.items()
            if key in PUBLIC_BLOCK_PROPS and isinstance(value, (str, int, float, bool))
        },
    }
    if block["type"] in MEDIA_TYPES:
        result["props"]["url"] = policy.validate(props.get("url"), media=True)
    content = block.get("content", [])
    result["content"] = (
        _public_table(content, policy)
        if block["type"] == "table"
        else _public_inline(content, policy)
    )
    result["children"] = [
        _public_v2(child, f"{path}-{index}", policy)
        for index, child in enumerate(block.get("children", []))
    ]
    return result


def public_note_blocks(
    blocks: object, *, url_policy: PublicUrlPolicy | None = None
) -> dict[str, Any]:
    """Project recognized content into public data without carrying private metadata."""
    policy = url_policy or PublicUrlPolicy()
    try:
        canonical = normalize_note_blocks(blocks)
    except (InvalidNoteContent, TypeError, ValueError, RecursionError):
        raise unsafe_site_content() from None
    if canonical["schema_version"] == 1:
        return {
            "schema_version": 1,
            "editor": "tiptap",
            "doc": _public_v1(canonical["doc"], policy),
        }
    return {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            _public_v2(block, str(index), policy)
            for index, block in enumerate(canonical["blocks"])
        ],
    }
