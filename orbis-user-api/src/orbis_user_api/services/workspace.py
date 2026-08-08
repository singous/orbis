from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.services.exceptions import (
    UserWorkspaceMissing,
    WorkspaceMemberAlreadyExists,
    WorkspaceMemberForbidden,
    WorkspaceMemberNotFound,
    WorkspaceNotFound,
    WorkspaceOwnerRemovalForbidden,
)


DEFAULT_PRIVATE_WORKSPACE_NAME = "私人空间"


def workspace_payload(workspace: Workspace, membership: WorkspaceMember, user: User) -> dict[str, object]:
    return {
        "id": workspace.id,
        "name": workspace.name,
        "workspace_type": workspace.workspace_type,
        "role": membership.role,
        "is_current": user.current_workspace_id == workspace.id,
        "created_at_ms": workspace.created_at_ms,
        "updated_at_ms": workspace.updated_at_ms,
    }


def member_payload(member: WorkspaceMember, user: User) -> dict[str, object]:
    return {
        "id": member.id,
        "user_id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": member.role,
        "status": member.status,
        "created_at_ms": member.created_at_ms,
        "updated_at_ms": member.updated_at_ms,
    }


async def get_active_membership(session: AsyncSession, workspace_id: UUID, user_id: UUID) -> WorkspaceMember | None:
    result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == "active",
        )
    )
    return result.scalar_one_or_none()


async def ensure_default_workspace(session: AsyncSession, user: User) -> Workspace:
    result = await session.execute(
        select(Workspace)
        .where(Workspace.owner_id == user.id, Workspace.workspace_type == "private", Workspace.status == "active")
        .order_by(Workspace.created_at_ms.asc())
    )
    workspace = result.scalars().first()
    if workspace is None:
        workspace = Workspace(
            tenant_id=user.tenant_id,
            owner_id=user.id,
            name=DEFAULT_PRIVATE_WORKSPACE_NAME,
            workspace_type="private",
        )
        session.add(workspace)
        await session.flush()

    member_result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    membership = member_result.scalar_one_or_none()
    timestamp = now_ms()
    if membership is None:
        session.add(
            WorkspaceMember(
                tenant_id=user.tenant_id,
                workspace_id=workspace.id,
                user_id=user.id,
                role="owner",
                status="active",
                created_at_ms=timestamp,
                updated_at_ms=timestamp,
            )
        )
    else:
        membership.role = "owner"
        membership.status = "active"
        membership.updated_at_ms = timestamp

    if user.current_workspace_id is None:
        user.current_workspace_id = workspace.id
        user.updated_at_ms = timestamp
    await session.flush()
    return workspace


async def list_workspaces(user: User, session: AsyncSession) -> list[dict[str, object]]:
    result = await session.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
            Workspace.status == "active",
        )
        .order_by(Workspace.created_at_ms.asc())
    )
    return [workspace_payload(workspace, membership, user) for workspace, membership in result.all()]


async def get_current_workspace(user: User, session: AsyncSession) -> tuple[Workspace, WorkspaceMember]:
    if user.current_workspace_id is not None:
        result = await session.execute(
            select(Workspace, WorkspaceMember)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                Workspace.id == user.current_workspace_id,
                Workspace.status == "active",
                WorkspaceMember.user_id == user.id,
                WorkspaceMember.status == "active",
            )
        )
        current = result.first()
        if current is not None:
            workspace, membership = current
            return workspace, membership

    result = await session.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
            Workspace.status == "active",
        )
        .order_by(Workspace.created_at_ms.asc())
    )
    fallback = result.first()
    if fallback is None:
        workspace = await ensure_default_workspace(session, user)
        membership = await get_active_membership(session, workspace.id, user.id)
        if membership is None:
            raise UserWorkspaceMissing
        await session.commit()
        return workspace, membership

    workspace, membership = fallback
    user.current_workspace_id = workspace.id
    user.updated_at_ms = now_ms()
    await session.commit()
    return workspace, membership


async def get_current_workspace_payload(user: User, session: AsyncSession) -> dict[str, object]:
    workspace, membership = await get_current_workspace(user, session)
    return workspace_payload(workspace, membership, user)


async def switch_current_workspace(workspace_id: UUID, user: User, session: AsyncSession) -> dict[str, object]:
    result = await session.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.id == workspace_id,
            Workspace.status == "active",
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
        )
    )
    row = result.first()
    if row is None:
        raise WorkspaceNotFound
    workspace, membership = row
    user.current_workspace_id = workspace.id
    user.updated_at_ms = now_ms()
    await session.commit()
    return workspace_payload(workspace, membership, user)


async def require_workspace_member(workspace_id: UUID, user: User, session: AsyncSession) -> Workspace:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None or workspace.status != "active":
        raise WorkspaceNotFound
    if user.is_superuser:
        return workspace
    membership = await get_active_membership(session, workspace_id, user.id)
    if membership is None:
        raise WorkspaceNotFound
    return workspace


async def require_workspace_owner(workspace_id: UUID, user: User, session: AsyncSession) -> Workspace:
    workspace = await require_workspace_member(workspace_id, user, session)
    if user.is_superuser:
        return workspace
    membership = await get_active_membership(session, workspace_id, user.id)
    if membership is None or membership.role != "owner":
        raise WorkspaceMemberForbidden
    return workspace


async def list_workspace_members(workspace_id: UUID, user: User, session: AsyncSession) -> list[dict[str, object]]:
    await require_workspace_member(workspace_id, user, session)
    result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status == "active")
        .order_by(WorkspaceMember.created_at_ms.asc())
    )
    return [member_payload(member, member_user) for member, member_user in result.all()]


async def add_workspace_member(
    workspace_id: UUID,
    email: str,
    user: User,
    session: AsyncSession,
) -> dict[str, object]:
    await require_workspace_owner(workspace_id, user, session)
    target_result = await session.execute(select(User).where(User.email == email.strip().lower(), User.status == "active"))
    target_user = target_result.scalar_one_or_none()
    if target_user is None:
        raise WorkspaceMemberNotFound

    member_result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == target_user.id,
        )
    )
    existing = member_result.scalar_one_or_none()
    timestamp = now_ms()
    if existing is not None and existing.status == "active":
        raise WorkspaceMemberAlreadyExists
    if existing is not None:
        existing.role = "member"
        existing.status = "active"
        existing.updated_at_ms = timestamp
        member = existing
    else:
        member = WorkspaceMember(
            tenant_id=target_user.tenant_id,
            workspace_id=workspace_id,
            user_id=target_user.id,
            role="member",
            status="active",
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
        session.add(member)
    await session.commit()
    await session.refresh(member)
    return member_payload(member, target_user)


async def remove_workspace_member(
    workspace_id: UUID,
    member_id: UUID,
    user: User,
    session: AsyncSession,
) -> None:
    await require_workspace_owner(workspace_id, user, session)
    member = await session.get(WorkspaceMember, member_id)
    if member is None or member.workspace_id != workspace_id or member.status != "active":
        raise WorkspaceMemberNotFound
    if member.user_id == user.id:
        raise WorkspaceOwnerRemovalForbidden

    if member.role == "owner":
        owner_count_result = await session.execute(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.status == "active",
                WorkspaceMember.role == "owner",
            )
        )
        if owner_count_result.scalar_one() <= 1:
            raise WorkspaceOwnerRemovalForbidden

    member.status = "removed"
    member.updated_at_ms = now_ms()
    await session.commit()
