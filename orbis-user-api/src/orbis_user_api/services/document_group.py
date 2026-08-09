from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.note import NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace
from orbis_user_api.schemas.note import (
    DocumentGroupCreateRequest,
    DocumentGroupUpdateRequest,
    ResourceStatus,
)
from orbis_user_api.services.exceptions import (
    DefaultDocumentGroupArchiveForbidden,
    DefaultDocumentGroupMissing,
    DocumentGroupNotFound,
)
from orbis_user_api.services.workspace import (
    get_current_workspace,
    require_workspace_member,
)

DEFAULT_DOCUMENT_GROUP_NAME = "默认分组"


async def ensure_default_document_group(
    session: AsyncSession, workspace: Workspace, user: User
) -> NoteGroup:
    result = await session.execute(
        select(NoteGroup)
        .where(
            NoteGroup.workspace_id == workspace.id,
            NoteGroup.is_default.is_(True),
            NoteGroup.status == "active",
        )
        .order_by(NoteGroup.created_at_ms.asc())
    )
    group = result.scalars().first()
    if group is not None:
        return group

    timestamp = now_ms()
    group = NoteGroup(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        name=DEFAULT_DOCUMENT_GROUP_NAME,
        is_default=True,
        sort_order=0,
        status="active",
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add(group)
    await session.flush()
    return group


async def get_default_document_group(
    session: AsyncSession, workspace: Workspace
) -> NoteGroup:
    result = await session.execute(
        select(NoteGroup).where(
            NoteGroup.workspace_id == workspace.id,
            NoteGroup.is_default.is_(True),
            NoteGroup.status == "active",
        )
    )
    group = result.scalars().first()
    if group is None:
        raise DefaultDocumentGroupMissing
    return group


async def list_document_groups(
    user: User,
    session: AsyncSession,
    resource_status: ResourceStatus = "active",
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[NoteGroup], int]:
    workspace, _ = await get_current_workspace(user, session)
    conditions = (
        NoteGroup.workspace_id == workspace.id,
        NoteGroup.status == resource_status,
    )
    total = await session.scalar(
        select(func.count(NoteGroup.id)).where(*conditions)
    )
    result = await session.execute(
        select(NoteGroup)
        .where(*conditions)
        .order_by(NoteGroup.sort_order.asc(), NoteGroup.created_at_ms.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all()), int(total or 0)


async def create_document_group(
    payload: DocumentGroupCreateRequest,
    user: User,
    session: AsyncSession,
) -> NoteGroup:
    workspace, _ = await get_current_workspace(user, session)
    group = NoteGroup(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        name=payload.name.strip(),
        is_default=False,
        sort_order=payload.sort_order,
    )
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


async def set_document_group_archived(
    group_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> NoteGroup:
    workspace, _ = await get_current_workspace(user, session)
    group = await session.get(NoteGroup, group_id)
    if (
        group is None
        or group.workspace_id != workspace.id
        or group.status not in {"active", "archived"}
    ):
        raise DocumentGroupNotFound
    if archived and group.is_default:
        raise DefaultDocumentGroupArchiveForbidden
    group.status = "archived" if archived else "active"
    group.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(group)
    return group


async def update_document_group(
    group_id: UUID,
    payload: DocumentGroupUpdateRequest,
    user: User,
    session: AsyncSession,
) -> NoteGroup:
    workspace, _ = await get_current_workspace(user, session)
    group = await session.get(NoteGroup, group_id)
    if group is None or group.workspace_id != workspace.id or group.status != "active":
        raise DocumentGroupNotFound
    if payload.name is not None:
        group.name = payload.name.strip()
    if payload.sort_order is not None:
        group.sort_order = payload.sort_order
    group.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(group)
    return group


async def get_document_group(
    group_id: UUID, workspace_id: UUID, user: User, session: AsyncSession
) -> NoteGroup:
    await require_workspace_member(workspace_id, user, session)
    group = await session.get(NoteGroup, group_id)
    if group is None or group.workspace_id != workspace_id or group.status != "active":
        raise DocumentGroupNotFound
    return group
