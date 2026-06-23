from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.models.note import Note
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import NoteContentUpdateRequest, NoteCreateRequest, NoteListResponse, NoteOut
from orbis_user_api.services.exceptions import NoteNotFound, NoteVersionConflict, UserWorkspaceMissing
from orbis_user_api.services.note import (
    create_note as create_note_service,
    get_note as get_note_service,
    list_notes as list_notes_service,
    update_note_content as update_note_content_service,
)

router = APIRouter(prefix="/v1/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
async def create_note(
    payload: NoteCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await create_note_service(payload, user, session)
    except UserWorkspaceMissing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing")


@router.get("", response_model=NoteListResponse)
async def list_notes(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteListResponse:
    return NoteListResponse(items=await list_notes_service(user, session))


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await get_note_service(note_id, user, session)
    except NoteNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")


@router.put("/{note_id}/content", response_model=NoteOut)
async def update_note_content(
    note_id: UUID,
    payload: NoteContentUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await update_note_content_service(note_id, payload, user, session)
    except NoteNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    except NoteVersionConflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Note version conflict")
