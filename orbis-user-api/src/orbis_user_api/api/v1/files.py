from __future__ import annotations

from fastapi import Depends, File, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import (
    ApiRouter,
    PageData,
    PaginationParams,
    build_page_data,
)
from orbis_user_api.api.errors import ApiError

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.user import User
from orbis_user_api.schemas.file import FileOut
from orbis_user_api.services.exceptions import UserWorkspaceMissing
from orbis_user_api.services.file import list_file_assets, upload_file_asset

router = ApiRouter(prefix="/files", tags=["files"])


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
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="USER_WORKSPACE_MISSING",
            message="用户未绑定可用工作空间",
        )


@router.get("", response_model=PageData[FileOut])
async def list_files(
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[FileOut]:
    items, total = await list_file_assets(
        user,
        session,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return build_page_data(
        items,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )
