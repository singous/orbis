from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.note import Note, NoteRevision, Notebook
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import DocumentContentUpdateRequest, DocumentCreateRequest
from orbis_user_api.services.exceptions import NoteNotFound, NoteVersionConflict, NotebookNotFound
from orbis_user_api.services.workspace import get_current_workspace


async def create_document(payload: DocumentCreateRequest, user: User, session: AsyncSession) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await session.get(Notebook, payload.notebook_id)
    if notebook is None or notebook.workspace_id != workspace.id or notebook.status != "active":
        raise NotebookNotFound

    document = Note(
        workspace_id=workspace.id,
        owner_id=user.id,
        notebook_id=notebook.id,
        title=payload.title.strip(),
        note_type="doc",
        blocks=payload.blocks,
        plain_text=payload.plain_text,
    )
    session.add(document)
    await session.flush()
    session.add(
        NoteRevision(
            note_id=document.id,
            version=document.content_version,
            blocks=document.blocks,
            plain_text=document.plain_text,
            created_by=user.id,
        )
    )
    await session.commit()
    await session.refresh(document)
    return document


async def list_documents(user: User, session: AsyncSession, notebook_id: UUID | None = None) -> list[Note]:
    workspace, _ = await get_current_workspace(user, session)
    conditions = [Note.workspace_id == workspace.id, Note.note_type == "doc", Note.status == "active"]
    if notebook_id is not None:
        conditions.append(Note.notebook_id == notebook_id)
    result = await session.execute(
        select(Note).where(*conditions).order_by(Note.updated_at_ms.desc(), Note.created_at_ms.desc())
    )
    return list(result.scalars().all())


async def get_document(document_id: UUID, user: User, session: AsyncSession) -> Note:
    workspace, _ = await get_current_workspace(user, session)
    document = await session.get(Note, document_id)
    if (
        document is None
        or document.workspace_id != workspace.id
        or document.note_type != "doc"
        or document.status == "deleted"
    ):
        raise NoteNotFound
    return document


async def update_document_content(
    document_id: UUID,
    payload: DocumentContentUpdateRequest,
    user: User,
    session: AsyncSession,
) -> Note:
    document = await get_document(document_id, user, session)
    if document.content_version != payload.expected_version:
        raise NoteVersionConflict

    next_version = document.content_version + 1
    if payload.title is not None:
        document.title = payload.title.strip()
    document.blocks = payload.blocks
    document.plain_text = payload.plain_text
    document.content_version = next_version
    document.updated_at_ms = now_ms()
    session.add(
        NoteRevision(
            note_id=document.id,
            version=next_version,
            blocks=payload.blocks,
            plain_text=payload.plain_text,
            created_by=user.id,
        )
    )
    await session.commit()
    await session.refresh(document)
    return document
