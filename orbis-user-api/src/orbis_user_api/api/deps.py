from __future__ import annotations

from collections.abc import AsyncIterator

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import decode_access_token
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import WorkspaceMember
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import (
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    settings = request.app.state.settings
    try:
        user_id = decode_access_token(token, settings)
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        ) from None

    user = await session.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        )
    return user


async def get_optional_current_user(
    request: Request,
    token: str | None = Depends(optional_oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    if token is None:
        return None
    settings = request.app.state.settings
    try:
        user_id = decode_access_token(token, settings)
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        ) from None

    user = await session.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        )
    return user


async def require_resource_manager(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMember:
    try:
        _, membership = await AuthorizationService.actor(user, session)
        AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource management forbidden",
        ) from None
    return membership


async def require_knowledge_base_deleter(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMember:
    try:
        _, membership = await AuthorizationService.actor(user, session)
        AuthorizationService.require_capability(
            membership, Capability.KNOWLEDGE_BASE_DELETE
        )
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Knowledge base deletion forbidden",
        ) from None
    return membership
