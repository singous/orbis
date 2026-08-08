from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.user import User
from orbis_user_api.schemas.file import FileListResponse, FileOut
from orbis_user_api.services.exceptions import UserWorkspaceMissing
from orbis_user_api.services.file import list_file_assets, upload_file_asset

router = APIRouter(prefix="/files", tags=["files"])


@router.post(
    "",
    response_model=FileOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def upload_file(
    request: Request,
    upload: UploadFile = File(alias="file"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileAsset:
    try:
        return await upload_file_asset(upload, request.app.state.storage, user, session)
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User workspace is missing"
        )


@router.get("", response_model=FileListResponse)
async def list_files(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileListResponse:
    return FileListResponse(items=await list_file_assets(user, session))
