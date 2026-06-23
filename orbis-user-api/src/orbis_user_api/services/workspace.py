from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace
from orbis_user_api.services.exceptions import UserWorkspaceMissing


async def get_personal_workspace(session: AsyncSession, user: User) -> Workspace:
    result = await session.execute(
        select(Workspace).where(Workspace.owner_id == user.id).order_by(Workspace.created_at_ms.asc())
    )
    workspace = result.scalars().first()
    if workspace is None:
        raise UserWorkspaceMissing
    return workspace
