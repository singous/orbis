from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

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

router = APIRouter(prefix="/auth", tags=["auth"])


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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    return AccessTokenResponse(access_token=access_token)
