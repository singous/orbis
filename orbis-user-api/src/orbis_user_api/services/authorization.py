from __future__ import annotations

from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.services.exceptions import (
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)
from orbis_user_api.services.workspace import get_current_workspace


class Capability(StrEnum):
    RESOURCE_READ = "resource.read"
    RESOURCE_MANAGE = "resource.manage"
    MEMBER_READ = "member.read"
    MEMBER_MANAGE = "member.manage"
    OWNERSHIP_TRANSFER = "ownership.transfer"
    KNOWLEDGE_BASE_DELETE = "knowledge_base.delete"


ROLE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    "owner": frozenset(Capability),
    "admin": frozenset(
        {
            Capability.RESOURCE_READ,
            Capability.RESOURCE_MANAGE,
            Capability.MEMBER_READ,
            Capability.MEMBER_MANAGE,
            Capability.KNOWLEDGE_BASE_DELETE,
        }
    ),
    "editor": frozenset(
        {Capability.RESOURCE_READ, Capability.RESOURCE_MANAGE, Capability.MEMBER_READ}
    ),
    "normal": frozenset({Capability.RESOURCE_READ, Capability.MEMBER_READ}),
}


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
