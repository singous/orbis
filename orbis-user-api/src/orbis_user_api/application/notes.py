from __future__ import annotations

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
    normalize_note_blocks,
)
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    MarkdownImportRequest,
    NoteContentUpdateRequest,
    NoteCreateRequest,
    NoteMetadataUpdateRequest,
)
from orbis_user_api.services.exceptions import (
    NotebookNotFound,
    NoteContentInvalid,
    NoteNotFound,
    NoteParentInvalid,
    NoteVersionConflict,
)
from orbis_user_api.services.workspace import get_current_workspace


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
    note.updated_at_ms = now_ms()
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


async def get_note_content(
    note_id: UUID, user: User, session: AsyncSession
) -> NoteContent:
    workspace, _ = await get_current_workspace(user, session)
    await _get_active_note(note_id, workspace.id, session)
    result = await session.execute(
        select(NoteContent).where(NoteContent.note_id == note_id)
    )
    content = result.scalar_one_or_none()
    if content is None:
        raise NoteNotFound
    return content


async def update_note_content(
    note_id: UUID,
    payload: NoteContentUpdateRequest,
    user: User,
    session: AsyncSession,
) -> NoteContent:
    try:
        blocks = normalize_note_blocks(payload.blocks)
    except InvalidNoteContent:
        raise NoteContentInvalid from None

    workspace, _ = await get_current_workspace(user, session)
    note = await _get_active_note(note_id, workspace.id, session)
    result = await session.execute(
        select(NoteContent).where(NoteContent.note_id == note.id)
    )
    content = result.scalar_one_or_none()
    if content is None:
        raise NoteNotFound
    if content.content_version != payload.expected_version:
        raise NoteVersionConflict

    timestamp = now_ms()
    content.blocks = blocks
    content.plain_text = derive_plain_text(blocks)
    content.content_version += 1
    content.updated_at_ms = timestamp
    note.updated_at_ms = timestamp
    await session.commit()
    await session.refresh(content)
    return content


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
    query: str | None, user: User, session: AsyncSession
) -> list[dict[str, Any]]:
    workspace, _ = await get_current_workspace(user, session)
    statement = (
        select(Note, NoteContent.plain_text)
        .join(NoteContent, NoteContent.note_id == Note.id)
        .join(Notebook, Notebook.id == Note.notebook_id)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(
            Note.workspace_id == workspace.id,
            Note.status == "active",
            Notebook.status == "active",
            NoteGroup.status == "active",
        )
    )
    normalized_query = (query or "").strip().lower()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        statement = statement.where(
            or_(
                func.lower(Note.title).like(pattern),
                func.lower(NoteContent.plain_text).like(pattern),
            )
        )
    result = await session.execute(
        statement.order_by(Note.updated_at_ms.desc(), Note.created_at_ms.desc())
    )
    return [
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
