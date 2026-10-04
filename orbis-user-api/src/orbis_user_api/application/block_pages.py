"""Byte-bounded sibling pages, shared by current and legacy content readers."""

from __future__ import annotations

import json
from typing import Any

# Leave room for the API success envelope and UTF-8 JSON encoding punctuation.
RESPONSE_ENVELOPE_RESERVE = 512
MIN_PAGE_BYTES = 4096
DEFAULT_PAGE_BYTES = 128 * 1024


def json_bytes(value: Any) -> int:
    return len(
        json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), default=str
        ).encode("utf-8")
    )


def descriptor(base, row):
    count = row["child_count"]
    return {
        "id": row["id"],
        "parent_id": base["parent_id"],
        "child_count": count,
        "has_children": count > 0,
        "children_loaded": count == 0,
        "payload_bytes": row["payload_bytes"],
        "payload_loaded": True,
    }


def placeholder(row):
    return {
        "id": row["id"],
        "type": row["block_type"],
        "props": {},
        "content": [],
        "children": [],
    }


def append(result, payload, desc, oversized, base):
    end = base["offset"] + len(result["descriptors"]) + 1
    return {
        **result,
        "blocks": {
            **result["blocks"],
            "blocks": [*result["blocks"]["blocks"], payload],
        },
        "descriptors": [*result["descriptors"], desc],
        "next_offset": end,
        "has_more": end < base["total_blocks"],
        "returned_bytes": result["returned_bytes"] + json_bytes(payload),
        "oversized_block": result["oversized_block"] or oversized,
    }


async def bounded_page(
    base: dict[str, Any],
    metadata: list[dict[str, Any]],
    load_payload,
    max_bytes: int,
    *,
    load_payloads=None,
) -> dict[str, Any]:
    """Plan a bounded prefix from sizes, then fetch permitted payloads in a batch.

    Descendants never enter the payload query. Oversized tables/code blocks
    remain explicit descriptors until the caller intentionally hydrates one.
    """
    empty = {
        **base,
        "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": []},
        "descriptors": [],
        "returned_bytes": 0,
        "oversized_block": False,
    }
    skeleton = empty
    estimate_delta = 0
    planned = []
    for row in metadata:
        desc = descriptor(base, row)
        stub = placeholder(row)
        delta = max(0, row["payload_bytes"] + 16 - json_bytes(stub))
        single = append(empty, stub, desc, False, base)
        oversized = json_bytes(single) + delta + RESPONSE_ENVELOPE_RESERVE > max_bytes
        if oversized:
            desc["payload_loaded"] = False
            delta = 0
        candidate = append(skeleton, stub, desc, oversized, base)
        if (
            planned
            and json_bytes(candidate)
            + estimate_delta
            + delta
            + RESPONSE_ENVELOPE_RESERVE
            > max_bytes
        ):
            break
        planned.append((row, desc, oversized))
        skeleton = candidate
        estimate_delta += delta
    payloads = (
        await load_payloads([row for row, desc, _ in planned if desc["payload_loaded"]])
        if load_payloads
        else None
    )
    result = empty
    for row, desc, oversized in planned:
        if desc["payload_loaded"]:
            own = (
                payloads[row["id"]] if payloads is not None else await load_payload(row)
            )
            payload = {**own, "children": []}
            if not desc["payload_bytes"]:
                desc["payload_bytes"] = json_bytes(own)
        else:
            payload = placeholder(row)
        candidate = append(result, payload, desc, oversized, base)
        if json_bytes(candidate) + RESPONSE_ENVELOPE_RESERVE > max_bytes:
            if result["descriptors"]:
                break
            # Compatible with block rows written before size metadata existed.
            desc["payload_loaded"] = False
            candidate = append(result, placeholder(row), desc, True, base)
        result = candidate
    return result
