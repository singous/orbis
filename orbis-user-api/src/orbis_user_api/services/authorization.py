from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.services.capabilities import ROLE_CAPABILITIES, Capability
from orbis_user_api.services.exceptions import (
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)
from orbis_user_api.services.workspace import get_current_workspace


class AuthorizationService:
    @staticmethod
    async def actor(
        user: User,
        session: AsyncSession,
    ) -> tuple[Workspace, WorkspaceMember]:
        workspace, membership = await get_current_workspace(user, session)
        if membership.role not in ROLE_CAPABILITIES:
            raise UserWorkspaceMissing
        return workspace, membership

    @staticmethod
    def require_capability(membership: WorkspaceMember, capability: Capability) -> None:
        if capability not in ROLE_CAPABILITIES.get(membership.role, frozenset()):
            raise WorkspaceMemberForbidden
