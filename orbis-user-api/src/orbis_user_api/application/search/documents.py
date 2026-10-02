from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, case, literal, or_, select
from sqlalchemy.sql import Select
from sqlalchemy.sql.selectable import CTE

from orbis_user_api.models.collaboration import NoteComment
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.schemas.search import SearchStatus

from .projection import (
    RANK_COMMENT,
    RANK_CONTENT,
    literal_match,
    projection,
    title_rank,
)


def active_note_ids(workspace_ids: list[UUID]) -> CTE:
    """Only root-reachable active notes have readable comments and editor routes."""
    roots = (
        select(Note.id, Note.notebook_id, Note.workspace_id)
        .join(
            Notebook,
            and_(
                Notebook.id == Note.notebook_id,
                Notebook.workspace_id == Note.workspace_id,
            ),
        )
        .join(
            NoteGroup,
            and_(
                NoteGroup.id == Notebook.group_id,
                NoteGroup.workspace_id == Note.workspace_id,
            ),
        )
        .where(
            Note.workspace_id.in_(workspace_ids),
            Note.status == "active",
            Note.parent_id.is_(None),
            Notebook.status == "active",
            NoteGroup.status == "active",
        )
        .cte("search_active_notes", recursive=True)
    )
    descendants = (
        select(Note.id, Note.notebook_id, Note.workspace_id)
        .join(
            roots,
            and_(
                Note.parent_id == roots.c.id,
                Note.notebook_id == roots.c.notebook_id,
                Note.workspace_id == roots.c.workspace_id,
            ),
        )
        .where(Note.status == "active")
    )
    return roots.union_all(descendants)


def _status_condition(own_status, active_condition, status):
    if status == "archived":
        return own_status == "archived"
    if status == "all":
        return or_(active_condition, own_status == "archived")
    return active_condition


def documents(query: str, workspace_ids: list[UUID], status: SearchStatus) -> Select:
    visible = active_note_ids(workspace_ids)
    readable = Note.id.in_(select(visible.c.id))
    title_match = literal_match(Note.title, query)
    body_match = literal_match(NoteContent.plain_text, query)
    comment_query = (
        select(NoteComment)
        .where(
            NoteComment.note_id == Note.id,
            NoteComment.workspace_id == Note.workspace_id,
            readable,
            literal_match(NoteComment.body, query),
        )
        .correlate(Note)
    )
    comment_match = comment_query.exists()
    comment_order = (NoteComment.updated_at_ms.desc(), NoteComment.id.asc())
    comment_body = (
        comment_query.with_only_columns(NoteComment.body)
        .order_by(*comment_order)
        .limit(1)
        .scalar_subquery()
    )
    comment_id = (
        comment_query.with_only_columns(NoteComment.id)
        .order_by(*comment_order)
        .limit(1)
        .scalar_subquery()
    )
    use_comment = and_(~title_match, ~body_match, comment_match)
    statement = (
        select(
            *projection(
                kind="document",
                model=Note,
                title=Note.title,
                location=NoteGroup.name + literal(" / ") + Notebook.title,
                snippet=case(
                    (title_match, Note.title),
                    (body_match, NoteContent.plain_text),
                    else_=comment_body,
                ),
                match=case(
                    (title_match, "title"), (body_match, "body"), else_="comment"
                ),
                rank=title_rank(
                    Note.title,
                    query,
                    case((body_match, RANK_CONTENT), else_=RANK_COMMENT),
                ),
                notebook_id=Note.notebook_id,
                group_id=Notebook.group_id,
                matched_comment_id=case((use_comment, comment_id), else_=None),
            )
        )
        .join(NoteContent, NoteContent.note_id == Note.id)
        .join(
            Notebook,
            and_(
                Notebook.id == Note.notebook_id,
                Notebook.workspace_id == Note.workspace_id,
            ),
        )
        .join(
            NoteGroup,
            and_(
                NoteGroup.id == Notebook.group_id,
                NoteGroup.workspace_id == Note.workspace_id,
            ),
        )
    )
    return statement.where(
        Note.workspace_id.in_(workspace_ids),
        Notebook.status.in_(("active", "archived")),
        NoteGroup.status.in_(("active", "archived")),
        _status_condition(Note.status, readable, status),
        or_(title_match, body_match, comment_match),
    )


def notebooks(query: str, workspace_ids: list[UUID], status: SearchStatus) -> Select:
    active = and_(Notebook.status == "active", NoteGroup.status == "active")
    return (
        select(
            *projection(
                kind="notebook",
                model=Notebook,
                title=Notebook.title,
                location=NoteGroup.name,
                snippet=Notebook.title,
                match=literal("title"),
                rank=title_rank(Notebook.title, query),
                notebook_id=Notebook.id,
                group_id=Notebook.group_id,
            )
        )
        .join(
            NoteGroup,
            and_(
                NoteGroup.id == Notebook.group_id,
                NoteGroup.workspace_id == Notebook.workspace_id,
            ),
        )
        .where(
            Notebook.workspace_id.in_(workspace_ids),
            NoteGroup.status.in_(("active", "archived")),
            _status_condition(Notebook.status, active, status),
            literal_match(Notebook.title, query),
        )
    )


def groups(query: str, workspace_ids: list[UUID], status: SearchStatus) -> Select:
    return select(
        *projection(
            kind="group",
            model=NoteGroup,
            title=NoteGroup.name,
            location=literal("文档分组"),
            snippet=NoteGroup.name,
            match=literal("title"),
            rank=title_rank(NoteGroup.name, query),
            group_id=NoteGroup.id,
        )
    ).where(
        NoteGroup.workspace_id.in_(workspace_ids),
        _status_condition(NoteGroup.status, NoteGroup.status == "active", status),
        literal_match(NoteGroup.name, query),
    )
