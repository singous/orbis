from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import (
    create_access_token,
    hash_refresh_token,
    new_refresh_token,
    refresh_token_expires_at_ms,
    verify_password,
)
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import RefreshSession, User
from orbis_user_api.models.workspace import WorkspaceInvitation, WorkspaceMember
from orbis_user_api.schemas.auth import LoginRequest, RefreshRequest
from orbis_user_api.services.exceptions import InvalidCredentials, InvalidRefreshToken


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def has_active_community_membership(user: User, session: AsyncSession) -> bool:
    if user.status != "active" or user.current_workspace_id is None:
        return False
    result = await session.execute(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == user.current_workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
            WorkspaceMember.role.in_(("owner", "admin", "editor", "normal")),
        )
    )
    return result.scalar_one_or_none() is not None


async def has_pending_invitation(user: User, session: AsyncSession) -> bool:
    if user.status != "active":
        return False
    result = await session.execute(
        select(WorkspaceInvitation.id).where(
            WorkspaceInvitation.email == user.email,
            WorkspaceInvitation.status == "pending",
            WorkspaceInvitation.expires_at_ms > now_ms(),
        )
    )
    return result.scalar_one_or_none() is not None


async def create_refresh_session(
    user: User, settings: Settings, session: AsyncSession
) -> str:
    token = new_refresh_token()
    refresh_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(token, settings),
        expires_at_ms=refresh_token_expires_at_ms(settings),
    )
    session.add(refresh_session)
    return token


async def login_user(
    payload: LoginRequest, settings: Settings, session: AsyncSession
) -> tuple[str, str, User]:
    result = await session.execute(
        select(User).where(User.email == normalize_email(str(payload.email)))
    )
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise InvalidCredentials
    if not await has_active_community_membership(
        user, session
    ) and not await has_pending_invitation(user, session):
        raise InvalidCredentials

    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    return create_access_token(user.id, settings), refresh_token, user


async def refresh_access_token(
    payload: RefreshRequest, settings: Settings, session: AsyncSession
) -> str:
    token_hash = hash_refresh_token(payload.refresh_token, settings)
    result = await session.execute(
        select(RefreshSession).where(RefreshSession.token_hash == token_hash)
    )
    refresh_session = result.scalar_one_or_none()
    if (
        refresh_session is None
        or refresh_session.revoked_at_ms is not None
        or refresh_session.expires_at_ms <= now_ms()
    ):
        raise InvalidRefreshToken

    user = await session.get(User, refresh_session.user_id)
    if user is None or not await has_active_community_membership(user, session):
        raise InvalidRefreshToken
    return create_access_token(user.id, settings)
