from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    refresh_token_expires_at_ms,
    verify_password,
)
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import RefreshSession, User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.schemas.auth import LoginRequest, LogoutRequest, RefreshRequest, RegisterRequest
from orbis_user_api.services.exceptions import EmailAlreadyRegistered, InvalidCredentials, InvalidRefreshToken


async def create_refresh_session(user: User, settings: Settings, session: AsyncSession) -> str:
    token = new_refresh_token()
    refresh_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(token, settings),
        expires_at_ms=refresh_token_expires_at_ms(settings),
    )
    session.add(refresh_session)
    return token


async def register_user(
    payload: RegisterRequest,
    settings: Settings,
    session: AsyncSession,
) -> tuple[str, str, User]:
    existing = await session.execute(select(User).where(User.email == str(payload.email)))
    if existing.scalar_one_or_none() is not None:
        raise EmailAlreadyRegistered

    user = User(
        email=str(payload.email),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    session.add(user)
    await session.flush()

    workspace = Workspace(owner_id=user.id, name="Personal")
    session.add(workspace)
    await session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))

    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    return create_access_token(user.id, settings), refresh_token, user


async def login_user(payload: LoginRequest, settings: Settings, session: AsyncSession) -> tuple[str, str, User]:
    result = await session.execute(select(User).where(User.email == str(payload.email)))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise InvalidCredentials

    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    return create_access_token(user.id, settings), refresh_token, user


async def refresh_access_token(payload: RefreshRequest, settings: Settings, session: AsyncSession) -> str:
    token_hash = hash_refresh_token(payload.refresh_token, settings)
    result = await session.execute(select(RefreshSession).where(RefreshSession.token_hash == token_hash))
    refresh_session = result.scalar_one_or_none()
    if (
        refresh_session is None
        or refresh_session.revoked_at_ms is not None
        or refresh_session.expires_at_ms <= now_ms()
    ):
        raise InvalidRefreshToken

    user = await session.get(User, refresh_session.user_id)
    if user is None or user.status != "active":
        raise InvalidRefreshToken
    return create_access_token(user.id, settings)


async def logout_refresh_session(payload: LogoutRequest, settings: Settings, session: AsyncSession) -> None:
    token_hash = hash_refresh_token(payload.refresh_token, settings)
    result = await session.execute(select(RefreshSession).where(RefreshSession.token_hash == token_hash))
    refresh_session = result.scalar_one_or_none()
    if refresh_session is not None and refresh_session.revoked_at_ms is None:
        refresh_session.revoked_at_ms = now_ms()
        await session.commit()
