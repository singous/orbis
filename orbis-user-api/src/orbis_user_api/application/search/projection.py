from __future__ import annotations

from sqlalchemy import case, func, literal

from orbis_user_api.db.types import GUID

SNIPPET_LENGTH = 240
SNIPPET_LEADING_CONTEXT = 64
RANK_EXACT_TITLE = 0
RANK_TITLE_PREFIX = 1
RANK_TITLE_CONTAINS = 2
RANK_CONTENT = 3
RANK_COMMENT = 4


def literal_match(column, query: str):
    """Treat SQL wildcard characters as user text, on SQLite and PostgreSQL."""
    return func.lower(column).contains(query.lower(), autoescape=True)


def title_rank(column, query: str, fallback=RANK_CONTENT):
    return case(
        (func.lower(column) == query.lower(), RANK_EXACT_TITLE),
        (
            func.lower(column).startswith(query.lower(), autoescape=True),
            RANK_TITLE_PREFIX,
        ),
        (literal_match(column, query), RANK_TITLE_CONTAINS),
        else_=fallback,
    )


def projection(
    *,
    kind,
    model,
    title,
    location,
    snippet,
    match,
    rank,
    status=None,
    updated=None,
    notebook_id=None,
    group_id=None,
    matched_comment_id=None,
):
    """All domains project the same scalar columns before union and pagination."""

    def optional_uuid(value):
        return literal(None, type_=GUID()) if value is None else value

    return [
        literal(kind).label("type"),
        model.id.label("id"),
        model.workspace_id.label("workspace_id"),
        title.label("title"),
        location.label("location"),
        snippet.label("snippet_source"),
        match.label("match"),
        optional_uuid(matched_comment_id).label("matched_comment_id"),
        (model.status if status is None else status).label("status"),
        (model.updated_at_ms if updated is None else updated).label("updated_at_ms"),
        optional_uuid(notebook_id).label("notebook_id"),
        optional_uuid(group_id).label("group_id"),
        rank.label("rank"),
    ]


def snippet(text: str, query: str) -> str:
    """Return bounded plain text around a match, never markup or full content."""
    normalized = " ".join(text.split())
    if len(normalized) <= SNIPPET_LENGTH:
        return normalized
    position = normalized.lower().find(" ".join(query.lower().split()))
    start = max(0, position - SNIPPET_LEADING_CONTEXT)
    prefix = "…" if start else ""
    available = SNIPPET_LENGTH - len(prefix)
    suffix = "…" if start + available < len(normalized) else ""
    return prefix + normalized[start : start + available - len(suffix)] + suffix
