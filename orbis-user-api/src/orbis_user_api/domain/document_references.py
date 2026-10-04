"""One reference contract for private writers, live shares and site rendering."""

from collections.abc import Iterator
from typing import Any
from uuid import UUID

MEDIA_TYPES = frozenset({"image", "file", "audio", "video"})
FILE_REFERENCE_PREFIX = "orbis-file:"
STRUCTURAL_KEYS = frozenset(
    {"blocks", "doc", "content", "children", "rows", "cells", "marks"}
)


def iter_document_references(value: Any) -> Iterator[tuple[str, bool]]:
    if isinstance(value, list):
        for item in value:
            yield from iter_document_references(item)
        return
    if not isinstance(value, dict):
        return
    kind = value.get("type")
    candidates: set[tuple[str, bool]] = set()
    if kind == "link" and isinstance(value.get("href"), str):
        candidates.add((value["href"], False))
    for fields in (value.get("props"), value.get("attrs")):
        if not isinstance(fields, dict):
            continue
        if kind in MEDIA_TYPES:
            for key in ("url", "src"):
                if isinstance(fields.get(key), str) and fields[key]:
                    candidates.add((fields[key], True))
        if kind in {"link", "card"} and isinstance(fields.get("href"), str):
            candidates.add((fields["href"], False))
    yield from sorted(candidates)
    # Traverse only renderer structure. Unknown props/attrs and legacy editor
    # caches are inert metadata, never permission to read a managed file.
    for key in STRUCTURAL_KEYS:
        child = value.get(key)
        if isinstance(child, (dict, list)):
            yield from iter_document_references(child)


def parse_document_file_reference(value: str) -> UUID | None:
    if not value.startswith(FILE_REFERENCE_PREFIX):
        return None
    raw = value.removeprefix(FILE_REFERENCE_PREFIX)
    try:
        identifier = UUID(raw)
    except (ValueError, AttributeError):
        return None
    return identifier if str(identifier) == raw else None


def managed_file_ids(value: Any) -> set[UUID]:
    return {
        identifier
        for reference, _media in iter_document_references(value)
        if (identifier := parse_document_file_reference(reference)) is not None
    }
