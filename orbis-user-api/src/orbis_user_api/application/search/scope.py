from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.errors import ApiError
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.schemas.search import SearchScope
from orbis_user_api.services.authorization import ROLE_CAPABILITIES, Capability

READABLE_ROLES = tuple(
    role
    for role, capabilities in ROLE_CAPABILITIES.items()
    if Capability.RESOURCE_READ in capabilities
)


async def accessible_workspaces(
    user: User, session: AsyncSession
) -> list[tuple[Workspace, WorkspaceMember]]:
    result = await session.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.status == "active",
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
            WorkspaceMember.role.in_(READABLE_ROLES),
        )
        .order_by(Workspace.created_at_ms.asc(), Workspace.id.asc())
    )
    return [(workspace, member) for workspace, member in result.all()]


def resolve_scope(
    rows: list[tuple[Workspace, WorkspaceMember]],
    current_workspace_id: UUID | None,
    scope: SearchScope,
    workspace_id: UUID | None,
) -> list[UUID]:
    if scope == "all" and workspace_id is not None:
        raise ApiError(
            status_code=422,
            code="SEARCH_SCOPE_INVALID",
            message="全部空间范围不能同时指定单个工作空间",
        )
    available = {workspace.id for workspace, _ in rows}
    selected = available if scope == "all" else {workspace_id or current_workspace_id}
    if not selected or not selected.issubset(available):
        raise ApiError(
            status_code=403,
            code="SEARCH_WORKSPACE_FORBIDDEN",
            message="需要所选工作空间的有效读取权限",
        )
    return sorted(selected, key=str)
