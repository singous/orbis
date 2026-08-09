from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.services.exceptions import UserWorkspaceMissing, WorkspaceNotFound

DEFAULT_PRIVATE_WORKSPACE_NAME = "私人空间"


def workspace_payload(
    workspace: Workspace, membership: WorkspaceMember, user: User
) -> dict[str, object]:
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


async def get_active_membership(
    session: AsyncSession, workspace_id: UUID, user_id: UUID
) -> WorkspaceMember | None:
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
        .where(
            Workspace.owner_id == user.id,
            Workspace.workspace_type == "private",
            Workspace.status == "active",
        )
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


async def get_current_workspace(
    user: User, session: AsyncSession
) -> tuple[Workspace, WorkspaceMember]:
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
        raise UserWorkspaceMissing

    workspace, membership = fallback
    user.current_workspace_id = workspace.id
    user.updated_at_ms = now_ms()
    await session.commit()
    return workspace, membership


async def require_workspace_member(
    workspace_id: UUID, user: User, session: AsyncSession
) -> Workspace:
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None or workspace.status != "active":
        raise WorkspaceNotFound
    membership = await get_active_membership(session, workspace_id, user.id)
    if membership is None:
        raise WorkspaceNotFound
    return workspace
