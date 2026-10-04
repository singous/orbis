from __future__ import annotations

import json
from copy import deepcopy
from typing import Any
from uuid import UUID

from orbis_user_api.domain.note_content import InvalidNoteContent, derive_plain_text

# Wide gaps allow ordinary inserts and moves without renumbering other blocks.
POSITION_STEP = 1 << 32


def flatten_blocks(blocks: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(siblings: list[dict[str, Any]], parent: str | None) -> None:
        for index, block in enumerate(siblings):
            identifier = block.get("id")
            if not isinstance(identifier, str) or not identifier or identifier in seen:
                raise InvalidNoteContent(
                    "Block identities must be unique within a document"
                )
            seen.add(identifier)
            payload = deepcopy(
                {key: value for key, value in block.items() if key != "children"}
            )
            records.append(
                {
                    "block_id": identifier,
                    "has_children_field": "children" in block,
                    "parent_id": parent,
                    "position": (index + 1) * POSITION_STEP,
                    "block_type": block["type"],
                    "payload": payload,
                    "payload_bytes": len(
                        json.dumps(
                            payload, ensure_ascii=False, separators=(",", ":")
                        ).encode("utf-8")
                    ),
                    "plain_text": derive_plain_text(
                        {"schema_version": 2, "blocks": [{**payload, "children": []}]}
                    ),
                }
            )
            visit(block.get("children", []), identifier)

    visit(blocks["blocks"], None)
    return records


def assemble_blocks(
    records: list[Any], roots: list[str] | None = None, *, preserve_shape: bool = True
) -> dict[str, Any]:
    siblings: dict[str | None, list[Any]] = {}
    for row in records:
        siblings.setdefault(row.parent_id, []).append(row)
    for group in siblings.values():
        group.sort(key=lambda row: (row.position, row.block_id))

    def build(row: Any) -> dict[str, Any]:
        children = [build(child) for child in siblings.get(row.block_id, [])]
        result = deepcopy(row.payload)
        if children or not preserve_shape or row.has_children_field:
            result["children"] = children
        return result

    top = siblings.get(None, [])
    if roots is not None:
        by_id = {row.block_id: row for row in top}
        top = [by_id[identifier] for identifier in roots if identifier in by_id]
    return {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [build(row) for row in top],
    }


def storage_blocks(
    note_id: UUID, blocks: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Disambiguate malformed legacy IDs only in the editable projection.

    Legacy whole-document reads retain their original snapshot. Ordinary valid
    IDs never change; deterministic path identities make migration retryable.
    """
    result, seen, changed = deepcopy(blocks), set(), False

    def visit(siblings, path):
        nonlocal changed
        for index, block in enumerate(siblings):
            child_path = [*path, index]
            identifier = block["id"]
            if identifier in seen:
                identifier = f"legacy-{note_id}-" + "-".join(map(str, child_path))
                while identifier in seen:
                    identifier += "-duplicate"
                block["id"] = identifier
                changed = True
            seen.add(identifier)
            visit(block.get("children", []), child_path)

    visit(result["blocks"], [])
    return result, changed
