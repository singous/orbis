from __future__ import annotations

from fastapi import Depends, File, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.infrastructure.image_thumbnail import InvalidThumbnail
from orbis_user_api.models.user import User
from orbis_user_api.schemas.user import UserAvatarOut, UserOut, UserProfileUpdate
from orbis_user_api.services.profile import (
    AvatarNotFound,
    AvatarTooLarge,
    read_avatar,
    set_avatar,
    update_profile,
)

router = ApiRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def current_user(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut, summary="编辑当前用户个人资料")
async def edit_profile(
    payload: UserProfileUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    return await update_profile(payload, user, session)


@router.put("/me/avatar", response_model=UserOut, summary="上传当前用户头像")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(..., description="PNG、JPEG 或 WebP 静态图片，最大 2 MiB。"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    try:
        return await set_avatar(file, request.app.state.storage, user, session)
    except AvatarTooLarge:
        raise ApiError(status_code=413, code="AVATAR_TOO_LARGE", message="头像图片不能超过 2 MiB") from None
    except InvalidThumbnail:
        raise ApiError(
            status_code=422,
            code="AVATAR_INVALID_IMAGE",
            message="请选择有效的 PNG、JPEG 或 WebP 静态图片，且不超过 16,777,216 像素",
        ) from None


@router.delete("/me/avatar", response_model=UserOut, summary="移除当前用户自定义头像")
async def remove_avatar(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    return await set_avatar(None, request.app.state.storage, user, session)


@router.get("/me/avatar", response_model=UserAvatarOut, summary="读取当前用户头像")
async def current_avatar(
    request: Request, user: User = Depends(get_current_user)
) -> UserAvatarOut:
    try:
        return UserAvatarOut(data_url=await read_avatar(request.app.state.storage, user))
    except AvatarNotFound:
        raise ApiError(status_code=404, code="AVATAR_NOT_FOUND", message="尚未设置自定义头像") from None
