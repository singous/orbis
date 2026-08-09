from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import WorkspaceMember
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import (
    WorkspaceMemberForbidden,
    WorkspaceMemberNotFound,
)
from orbis_user_api.services.workspace import member_payload


async def list_members(
    actor_user: User,
    session: AsyncSession,
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[dict[str, object]], int]:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_READ)
    conditions = (
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.status == "active",
    )
    total = await session.scalar(
        select(func.count(WorkspaceMember.id)).where(*conditions)
    )
    result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(*conditions)
        .order_by(WorkspaceMember.created_at_ms.asc())
        .offset(offset)
        .limit(limit)
    )
    return (
        [
            member_payload(membership, member_user)
            for membership, member_user in result.all()
        ],
        int(total or 0),
    )


async def update_member_role(
    member_id: UUID,
    role: str,
    actor_user: User,
    session: AsyncSession,
) -> dict[str, object]:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)

    result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.id == member_id,
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == "active",
        )
    )
    row = result.first()
    if row is None:
        raise WorkspaceMemberNotFound
    target_membership, target_user = row

    if target_membership.role == "owner":
        raise WorkspaceMemberForbidden
    if actor_membership.role == "admin" and (
        target_membership.role not in {"editor", "normal"}
        or role not in {"editor", "normal"}
    ):
        raise WorkspaceMemberForbidden
    target_membership.role = role
    target_membership.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(target_membership)
    return member_payload(target_membership, target_user)


async def remove_member(
    member_id: UUID,
    actor_user: User,
    session: AsyncSession,
) -> None:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)
    result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.id == member_id,
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == "active",
        )
    )
    target_membership = result.scalar_one_or_none()
    if target_membership is None:
        raise WorkspaceMemberNotFound
    if target_membership.role == "owner":
        raise WorkspaceMemberForbidden
    if actor_membership.role == "admin" and target_membership.role == "admin":
        raise WorkspaceMemberForbidden

    target_membership.status = "removed"
    target_membership.updated_at_ms = now_ms()
    await session.commit()
