from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.models.note import Notebook
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    NotebookCreateRequest,
    NotebookListResponse,
    NotebookOut,
)
from orbis_user_api.services.exceptions import (
    DefaultDocumentGroupMissing,
    DocumentGroupNotFound,
    UserWorkspaceMissing,
)
from orbis_user_api.services.notebook import create_notebook as create_notebook_service
from orbis_user_api.services.notebook import list_notebooks as list_notebooks_service

router = APIRouter(prefix="/notebooks", tags=["notebooks"])


@router.get("", response_model=NotebookListResponse)
async def list_notebooks(
    group_id: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotebookListResponse:
    try:
        return NotebookListResponse(
            items=await list_notebooks_service(user, session, group_id)
        )
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None


@router.post(
    "",
    response_model=NotebookOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_notebook(
    payload: NotebookCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notebook:
    try:
        return await create_notebook_service(payload, user, session)
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        ) from None
    except DefaultDocumentGroupMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Default document group is missing",
        ) from None
    except DocumentGroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document group not found"
        ) from None
