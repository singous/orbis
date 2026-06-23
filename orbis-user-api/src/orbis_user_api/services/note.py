from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.note import Note, NoteRevision
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import NoteContentUpdateRequest, NoteCreateRequest
from orbis_user_api.services.exceptions import NoteNotFound, NoteVersionConflict
from orbis_user_api.services.workspace import get_personal_workspace


async def create_note(payload: NoteCreateRequest, user: User, session: AsyncSession) -> Note:
    workspace = await get_personal_workspace(session, user)
    note = Note(
        workspace_id=workspace.id,
        owner_id=user.id,
        title=payload.title,
        note_type=payload.note_type,
        blocks=payload.blocks,
        plain_text=payload.plain_text,
    )
    session.add(note)
    await session.flush()
    session.add(
        NoteRevision(
            note_id=note.id,
            version=note.content_version,
            blocks=note.blocks,
            plain_text=note.plain_text,
            created_by=user.id,
        )
    )
    await session.commit()
    await session.refresh(note)
    return note


async def list_notes(user: User, session: AsyncSession) -> list[Note]:
    result = await session.execute(
        select(Note)
        .where(Note.owner_id == user.id, Note.status == "active")
        .order_by(Note.updated_at_ms.desc(), Note.created_at_ms.desc())
    )
    return list(result.scalars().all())


async def get_note(note_id: UUID, user: User, session: AsyncSession) -> Note:
    note = await session.get(Note, note_id)
    if note is None or note.owner_id != user.id or note.status == "deleted":
        raise NoteNotFound
    return note


async def update_note_content(
    note_id: UUID,
    payload: NoteContentUpdateRequest,
    user: User,
    session: AsyncSession,
) -> Note:
    note = await get_note(note_id, user, session)
    if note.content_version != payload.expected_version:
        raise NoteVersionConflict

    next_version = note.content_version + 1
    if payload.title is not None:
        note.title = payload.title
    note.blocks = payload.blocks
    note.plain_text = payload.plain_text
    note.content_version = next_version
    note.updated_at_ms = now_ms()
    session.add(
        NoteRevision(
            note_id=note.id,
            version=next_version,
            blocks=payload.blocks,
            plain_text=payload.plain_text,
            created_by=user.id,
        )
    )
    await session.commit()
    await session.refresh(note)
    return note
