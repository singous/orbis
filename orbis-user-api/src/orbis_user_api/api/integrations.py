from __future__ import annotations

from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.application.integration_auth import (
    create_token,
    error,
    token_public,
)
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.integration import IntegrationToken
from orbis_user_api.models.user import User
from orbis_user_api.schemas.integration import TokenCreate
from orbis_user_api.services.workspace import get_current_workspace

router = ApiRouter(prefix="/integrations", tags=["integrations"])


@router.post("/tokens", status_code=201)
async def issue_token(
    payload: TokenCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await create_token(payload, user, session)


@router.get("/tokens")
async def list_tokens(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    workspace, _ = await get_current_workspace(user, session)
    rows = await session.scalars(
        select(IntegrationToken)
        .where(
            IntegrationToken.workspace_id == workspace.id,
            IntegrationToken.owner_id == user.id,
        )
        .order_by(IntegrationToken.created_at_ms.desc())
        .limit(100)
    )
    return {"items": [token_public(row) for row in rows]}


@router.post("/tokens/{token_id}/revoke")
async def revoke_token(
    token_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    workspace, _ = await get_current_workspace(user, session)
    token = await session.get(IntegrationToken, token_id)
    if token is None or token.owner_id != user.id or token.workspace_id != workspace.id:
        raise error(404, "INTEGRATION_TOKEN_NOT_FOUND", "集成令牌不存在")
    if token.revoked_at_ms is None:
        token.revoked_at_ms = now_ms()
        await session.commit()
    return token_public(token)
