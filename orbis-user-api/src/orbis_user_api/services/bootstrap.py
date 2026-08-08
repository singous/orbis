from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import hash_password
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import User
from orbis_user_api.services.auth import normalize_email
from orbis_user_api.services.document_group import ensure_default_document_group
from orbis_user_api.services.workspace import ensure_default_workspace


async def bootstrap_superuser(settings: Settings, session: AsyncSession) -> None:
    if not settings.bootstrap_superuser_enabled:
        return

    email = normalize_email(settings.bootstrap_superuser_email)
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    timestamp = now_ms()
    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(settings.bootstrap_superuser_password),
            display_name="Orbis Admin",
            is_superuser=True,
            status="active",
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
        session.add(user)
        await session.flush()
    else:
        changed = False
        if not user.is_superuser:
            user.is_superuser = True
            changed = True
        if user.status != "active":
            user.status = "active"
            changed = True
        if changed:
            user.updated_at_ms = timestamp

    workspace = await ensure_default_workspace(session, user)
    await ensure_default_document_group(session, workspace, user)
    await session.commit()
