from __future__ import annotations

from fastapi import Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.errors import ApiError

from orbis_user_api.api.deps import get_session
from orbis_user_api.schemas.auth import (
    AccessTokenResponse,
    AuthResponse,
    LoginRequest,
    RefreshRequest,
)
from orbis_user_api.services.auth import (
    login_user,
)
from orbis_user_api.services.auth import (
    refresh_access_token as refresh_access_token_service,
)
from orbis_user_api.services.exceptions import (
    InvalidCredentials,
    InvalidRefreshToken,
    UserWorkspaceMissing,
)
from orbis_user_api.services.workspace import get_current_workspace, workspace_payload

router = ApiRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        access_token, refresh_token, user = await login_user(
            payload, request.app.state.settings, session
        )
    except InvalidCredentials:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_CREDENTIALS",
            message="邮箱或密码错误",
        )
    try:
        workspace, membership = await get_current_workspace(user, session)
    except UserWorkspaceMissing:
        current_workspace = None
    else:
        current_workspace = workspace_payload(workspace, membership, user)
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
        workspace=current_workspace,
    )


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh_access_token(
    payload: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AccessTokenResponse:
    try:
        access_token = await refresh_access_token_service(
            payload, request.app.state.settings, session
        )
    except InvalidRefreshToken:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVALID_REFRESH_TOKEN",
            message="刷新令牌无效或已过期",
        )
    return AccessTokenResponse(access_token=access_token)
