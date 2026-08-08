from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.models.note import Note
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    DocumentContentUpdateRequest,
    DocumentCreateRequest,
    DocumentListResponse,
    DocumentOut,
)
from orbis_user_api.services.document import (
    create_document as create_document_service,
)
from orbis_user_api.services.document import (
    get_document as get_document_service,
)
from orbis_user_api.services.document import (
    list_documents as list_documents_service,
)
from orbis_user_api.services.document import (
    update_document_content as update_document_content_service,
)
from orbis_user_api.services.exceptions import (
    NotebookNotFound,
    NoteNotFound,
    NoteVersionConflict,
    UserWorkspaceMissing,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    notebook_id: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DocumentListResponse:
    try:
        return DocumentListResponse(
            items=await list_documents_service(user, session, notebook_id)
        )
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None


@router.post(
    "",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_document(
    payload: DocumentCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await create_document_service(payload, user, session)
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None
    except NotebookNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notebook not found"
        ) from None


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await get_document_service(document_id, user, session)
    except NoteNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        ) from None
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None


@router.put(
    "/{document_id}/content",
    response_model=DocumentOut,
    dependencies=[Depends(require_resource_manager)],
)
async def update_document_content(
    document_id: UUID,
    payload: DocumentContentUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await update_document_content_service(
            document_id, payload, user, session
        )
    except NoteNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        ) from None
    except NoteVersionConflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Document version conflict"
        ) from None
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None
