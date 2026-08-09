from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import create_access_token, hash_password
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.community import CommunityState, CommunityTenant
from orbis_user_api.models.user import User
from orbis_user_api.schemas.setup import SetupRequest
from orbis_user_api.services.auth import create_refresh_session, normalize_email
from orbis_user_api.services.document_group import ensure_default_document_group
from orbis_user_api.services.exceptions import SystemAlreadyInitialized
from orbis_user_api.services.workspace import ensure_default_workspace, get_active_membership, workspace_payload

logger = logging.getLogger(__name__)


async def setup_community(
    payload: SetupRequest,
    settings: Settings,
    session: AsyncSession,
) -> tuple[str, str, User, dict[str, object]]:
    state_result = await session.execute(select(CommunityState.id).limit(1))
    user_result = await session.execute(select(User.id).limit(1))
    if state_result.scalar_one_or_none() is not None or user_result.scalar_one_or_none() is not None:
        raise SystemAlreadyInitialized

    timestamp = now_ms()
    tenant = CommunityTenant(created_at_ms=timestamp, updated_at_ms=timestamp)
    session.add(tenant)
    await session.flush()

    user = User(
        tenant_id=tenant.id,
        email=normalize_email(str(payload.email)),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        status="active",
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add(user)
    await session.flush()

    workspace = await ensure_default_workspace(session, user)
    await ensure_default_document_group(session, workspace, user)
    membership = await get_active_membership(session, workspace.id, user.id)
    if membership is None:
        raise RuntimeError("Owner membership was not created")

    session.add(
        CommunityState(
            tenant_id=tenant.id,
            owner_user_id=user.id,
            setup_completed_at_ms=timestamp,
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
    )
    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    await session.refresh(user)
    await session.refresh(workspace)

    logger.info(
        "Community setup completed",
        extra={"user_id": str(user.id), "workspace_id": str(workspace.id), "tenant_id": str(tenant.id)},
    )
    return (
        create_access_token(user.id, settings),
        refresh_token,
        user,
        workspace_payload(workspace, membership, user),
    )
