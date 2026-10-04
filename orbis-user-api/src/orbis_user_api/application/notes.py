from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    blocks_to_markdown,
    derive_plain_text,
    empty_note_blocks,
    markdown_to_blocks,
)
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    MarkdownImportRequest,
    NoteContentUpdateRequest,
    NoteCreateRequest,
    NoteMetadataUpdateRequest,
    NoteOrderRequest,
    ResourceStatus,
)
from orbis_user_api.services.exceptions import (
    ArchiveRestoreDependencyInactive,
    NotebookNotFound,
    NoteContentInvalid,
    NoteNotFound,
    NoteOrderConflict,
    NoteParentInvalid,
)
from orbis_user_api.services.workspace import get_current_workspace

logger = logging.getLogger(__name__)


async def _get_active_notebook(
    notebook_id: UUID, workspace_id: UUID, session: AsyncSession
) -> Notebook:
    notebook = await session.get(Notebook, notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != workspace_id
        or notebook.status != "active"
    ):
        raise NotebookNotFound
    group = await session.get(NoteGroup, notebook.group_id)
    if group is None or group.workspace_id != workspace_id or group.status != "active":
        raise NotebookNotFound
    return notebook


async def _get_active_note(
    note_id: UUID, workspace_id: UUID, session: AsyncSession
) -> Note:
    note = await session.get(Note, note_id)
    if note is None or note.workspace_id != workspace_id or note.status != "active":
        raise NoteNotFound
    await _get_active_notebook(note.notebook_id, workspace_id, session)
    return note


async def _validate_parent(
    parent_id: UUID | None,
    notebook_id: UUID,
    workspace_id: UUID,
    session: AsyncSession,
) -> None:
    if parent_id is None:
        return
    parent = await session.get(Note, parent_id)
    if (
        parent is None
        or parent.workspace_id != workspace_id
        or parent.notebook_id != notebook_id
        or parent.status != "active"
    ):
        raise NoteParentInvalid


async def create_note(
    payload: NoteCreateRequest, user: User, session: AsyncSession
) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await _get_active_notebook(payload.notebook_id, workspace.id, session)
    await _validate_parent(payload.parent_id, notebook.id, workspace.id, session)

    note = Note(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        notebook_id=notebook.id,
        parent_id=payload.parent_id,
        title=payload.title.strip(),
        sort_order=payload.sort_order,
        note_type="doc",
    )
    session.add(note)
    await session.flush()
    session.add(
        NoteContent(
            note_id=note.id,
            blocks=empty_note_blocks(),
            plain_text="",
            content_version=1,
        )
    )
    await session.flush()
    from orbis_user_api.application.block_content import BlockContentStore

    await BlockContentStore(session, note).activate()
    await session.commit()
    await session.refresh(note)
    return note


async def get_note(note_id: UUID, user: User, session: AsyncSession) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    return await _get_active_note(note_id, workspace.id, session)


async def update_note_metadata(
    note_id: UUID,
    payload: NoteMetadataUpdateRequest,
    user: User,
    session: AsyncSession,
) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    note = await _get_active_note(note_id, workspace.id, session)

    if "parent_id" in payload.model_fields_set and payload.parent_id is not None:
        await _validate_parent(
            payload.parent_id, note.notebook_id, workspace.id, session
        )
        seen: set[UUID] = set()
        cursor = await session.get(Note, payload.parent_id)
        while cursor is not None:
            if cursor.id == note.id or cursor.id in seen:
                raise NoteParentInvalid
            seen.add(cursor.id)
            cursor = (
                await session.get(Note, cursor.parent_id)
                if cursor.parent_id is not None
                else None
            )

    if payload.title is not None:
        note.title = payload.title.strip()
    if "parent_id" in payload.model_fields_set:
        note.parent_id = payload.parent_id
    if payload.sort_order is not None:
        note.sort_order = payload.sort_order
    from sqlalchemy import case, update

    timestamp = now_ms()
    # Preserve existing last-writer-wins metadata edits while making the token
    # used by conditional Agent writes strictly advance, even within one ms.
    await session.execute(
        update(Note)
        .where(Note.id == note.id, Note.workspace_id == workspace.id)
        .values(
            updated_at_ms=case(
                (Note.updated_at_ms >= timestamp, Note.updated_at_ms + 1),
                else_=timestamp,
            )
        )
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    await session.refresh(note)
    return note


async def set_note_archived(
    note_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    note = await session.get(Note, note_id)
    if (
        note is None
        or note.workspace_id != workspace.id
        or note.status not in {"active", "archived"}
    ):
        raise NoteNotFound
    if not archived:
        notebook = await session.get(Notebook, note.notebook_id)
        if (
            notebook is None
            or notebook.workspace_id != workspace.id
            or notebook.status != "active"
        ):
            raise ArchiveRestoreDependencyInactive
        group = await session.get(NoteGroup, notebook.group_id)
        if (
            group is None
            or group.workspace_id != workspace.id
            or group.status != "active"
        ):
            raise ArchiveRestoreDependencyInactive
        seen_ancestor_ids: set[UUID] = set()
        ancestor_id = note.parent_id
        while ancestor_id is not None:
            if ancestor_id in seen_ancestor_ids:
                raise ArchiveRestoreDependencyInactive
            seen_ancestor_ids.add(ancestor_id)
            parent = await session.get(Note, ancestor_id)
            if (
                parent is None
                or parent.workspace_id != workspace.id
                or parent.notebook_id != notebook.id
                or parent.status != "active"
            ):
                raise ArchiveRestoreDependencyInactive
            ancestor_id = parent.parent_id
    note.status = "archived" if archived else "active"
    note.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(note)
    return note


def _tree_payload(note: Note, children: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": note.id,
        "tenant_id": note.tenant_id,
        "workspace_id": note.workspace_id,
        "notebook_id": note.notebook_id,
        "parent_id": note.parent_id,
        "owner_id": note.owner_id,
        "title": note.title,
        "sort_order": note.sort_order,
        "status": note.status,
        "created_at_ms": note.created_at_ms,
        "updated_at_ms": note.updated_at_ms,
        "children": children,
    }


async def get_note_tree(
    notebook_id: UUID, user: User, session: AsyncSession
) -> list[dict[str, Any]]:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await _get_active_notebook(notebook_id, workspace.id, session)
    result = await session.execute(
        select(Note)
        .where(
            Note.workspace_id == workspace.id,
            Note.notebook_id == notebook.id,
            Note.status == "active",
        )
        .order_by(Note.sort_order.asc(), Note.created_at_ms.asc())
    )
    notes = list(result.scalars())
    children_by_parent: dict[UUID | None, list[Note]] = defaultdict(list)
    for note in notes:
        children_by_parent[note.parent_id].append(note)

    def build(parent_id: UUID | None) -> list[dict[str, Any]]:
        return [
            _tree_payload(note, build(note.id))
            for note in children_by_parent[parent_id]
        ]

    return build(None)


async def reorder_notes(
    notebook_id: UUID,
    payload: NoteOrderRequest,
    user: User,
    session: AsyncSession,
) -> list[dict[str, Any]]:
    workspace, _ = await get_current_workspace(user, session)
    await _get_active_notebook(notebook_id, workspace.id, session)
    await _validate_parent(payload.parent_id, notebook_id, workspace.id, session)
    result = await session.execute(
        select(Note)
        .where(
            Note.workspace_id == workspace.id,
            Note.notebook_id == notebook_id,
            Note.parent_id == payload.parent_id,
            Note.status == "active",
        )
        .order_by(Note.id)
        .with_for_update()
    )
    siblings = list(result.scalars())
    current_ids = [
        note.id
        for note in sorted(
            siblings,
            key=lambda note: (note.sort_order, note.created_at_ms, note.id),
        )
    ]
    if (
        current_ids != payload.expected_note_ids
        or len(current_ids) != len(payload.note_ids)
        or set(current_ids) != set(payload.note_ids)
    ):
        raise NoteOrderConflict

    by_id = {note.id: note for note in siblings}
    for index, note_id in enumerate(payload.note_ids):
        by_id[note_id].sort_order = index
    await session.commit()
    logger.info(
        "Reordered sibling documents: notebook_id=%s parent_id=%s count=%s",
        notebook_id,
        payload.parent_id,
        len(siblings),
    )
    return await get_note_tree(notebook_id, user, session)


async def get_note_content(
    note_id: UUID, user: User, session: AsyncSession
) -> NoteContent:
    from orbis_user_api.application.block_content import read_stored_content

    note = await get_note(note_id, user, session)
    return await read_stored_content(note, session)


async def update_note_content(
    note_id: UUID,
    payload: NoteContentUpdateRequest,
    user: User,
    session: AsyncSession,
) -> NoteContent:
    from orbis_user_api.application.block_content import BlockContentStore

    note = await get_note(note_id, user, session)
    return await BlockContentStore(session, note).replace(
        payload.expected_version, payload.blocks, user
    )


async def import_markdown_note(
    payload: MarkdownImportRequest,
    user: User,
    session: AsyncSession,
) -> Note:
    try:
        blocks = markdown_to_blocks(payload.markdown)
    except InvalidNoteContent:
        raise NoteContentInvalid from None

    workspace, _ = await get_current_workspace(user, session)
    notebook = await _get_active_notebook(payload.notebook_id, workspace.id, session)
    await _validate_parent(payload.parent_id, notebook.id, workspace.id, session)
    note = Note(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        notebook_id=notebook.id,
        parent_id=payload.parent_id,
        title=payload.title.strip(),
        sort_order=payload.sort_order,
        note_type="doc",
    )
    session.add(note)
    await session.flush()
    session.add(
        NoteContent(
            note_id=note.id,
            blocks=blocks,
            plain_text=derive_plain_text(blocks),
            content_version=1,
        )
    )
    await session.flush()
    from orbis_user_api.application.block_content import BlockContentStore

    await BlockContentStore(session, note).activate()
    await session.commit()
    await session.refresh(note)
    return note


async def export_note_markdown(
    note_id: UUID, user: User, session: AsyncSession
) -> tuple[Note, str]:
    note = await get_note(note_id, user, session)
    content = await get_note_content(note_id, user, session)
    return note, blocks_to_markdown(content.blocks)


async def search_notes(
    query: str | None,
    user: User,
    session: AsyncSession,
    resource_status: ResourceStatus = "active",
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    from orbis_user_api.application.block_search import ContentText

    body_text = ContentText(Note.id, NoteContent.plain_text)
    workspace, _ = await get_current_workspace(user, session)
    conditions = [
        Note.workspace_id == workspace.id,
        Note.status == resource_status,
    ]
    if resource_status == "active":
        conditions.extend([Notebook.status == "active", NoteGroup.status == "active"])
    statement = (
        select(Note, body_text)
        .join(NoteContent, NoteContent.note_id == Note.id)
        .join(Notebook, Notebook.id == Note.notebook_id)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(*conditions)
    )
    normalized_query = (query or "").strip().lower()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                func.lower(Note.title).like(pattern),
                func.lower(body_text).like(pattern),
            )
        )
    count_statement = (
        select(func.count(Note.id))
        .join(NoteContent, NoteContent.note_id == Note.id)
        .join(Notebook, Notebook.id == Note.notebook_id)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(*conditions)
    )
    if normalized_query:
        count_statement = count_statement.where(
            or_(
                func.lower(Note.title).like(pattern),
                func.lower(body_text).like(pattern),
            )
        )
    total = await session.scalar(count_statement)
    result = await session.execute(
        statement.order_by(Note.updated_at_ms.desc(), Note.created_at_ms.desc())
        .offset(offset)
        .limit(limit)
    )
    items = [
        {
            "id": note.id,
            "tenant_id": note.tenant_id,
            "workspace_id": note.workspace_id,
            "owner_id": note.owner_id,
            "notebook_id": note.notebook_id,
            "parent_id": note.parent_id,
            "sort_order": note.sort_order,
            "title": note.title,
            "note_type": note.note_type,
            "plain_text": plain_text,
            "status": note.status,
            "created_at_ms": note.created_at_ms,
            "updated_at_ms": note.updated_at_ms,
        }
        for note, plain_text in result.all()
    ]
    return items, int(total or 0)
