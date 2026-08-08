from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.models.note import NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    DocumentGroupCreateRequest,
    DocumentGroupListResponse,
    DocumentGroupOut,
)
from orbis_user_api.services.document_group import (
    create_document_group as create_document_group_service,
)
from orbis_user_api.services.document_group import (
    list_document_groups as list_document_groups_service,
)
from orbis_user_api.services.exceptions import UserWorkspaceMissing

router = APIRouter(prefix="/document-groups", tags=["document-groups"])


@router.get("", response_model=DocumentGroupListResponse)
async def list_document_groups(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DocumentGroupListResponse:
    try:
        return DocumentGroupListResponse(
            items=await list_document_groups_service(user, session)
        )
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None


@router.post(
    "",
    response_model=DocumentGroupOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_document_group(
    payload: DocumentGroupCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteGroup:
    try:
        return await create_document_group_service(payload, user, session)
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None
