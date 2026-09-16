from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import FileResponse
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
from orbis_user_api.services.file import (
    FileAssetNotFound,
    list_file_assets,
    read_file_asset,
    upload_file_asset,
)

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


async def get_file_content(
    file_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    try:
        return await read_file_asset(
            file_id,
            request.app.state.storage,
            user,
            session,
        )
    except FileAssetNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="FILE_NOT_FOUND",
            message="文件不存在或不属于当前工作空间",
        ) from None


# Binary responses intentionally bypass ApiRouter's JSON success envelope while
# retaining its authentication dependencies and the application's JSON errors.
APIRouter.add_api_route(
    router,
    "/{file_id}/content",
    get_file_content,
    methods=["GET"],
    response_class=FileResponse,
    response_model=None,
    responses={
        200: {
            "description": "文件二进制内容",
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
