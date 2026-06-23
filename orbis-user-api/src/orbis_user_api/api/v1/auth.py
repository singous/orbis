from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_session
from orbis_user_api.schemas.auth import (
    AccessTokenResponse,
    AuthResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
)
from orbis_user_api.services.auth import (
    login_user,
    logout_refresh_session,
    refresh_access_token as refresh_access_token_service,
    register_user,
)
from orbis_user_api.services.exceptions import (
    EmailAlreadyRegistered,
    InvalidCredentials,
    InvalidRefreshToken,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        access_token, refresh_token, user = await register_user(payload, request.app.state.settings, session)
    except EmailAlreadyRegistered:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user)


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        access_token, refresh_token, user = await login_user(payload, request.app.state.settings, session)
    except InvalidCredentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user)


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh_access_token(
    payload: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AccessTokenResponse:
    try:
        access_token = await refresh_access_token_service(payload, request.app.state.settings, session)
    except InvalidRefreshToken:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return AccessTokenResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> None:
    await logout_refresh_session(payload, request.app.state.settings, session)
