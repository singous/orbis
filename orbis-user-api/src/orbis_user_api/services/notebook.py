from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.time import now_ms
from orbis_user_api.models.note import Notebook, NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    NotebookCreateRequest,
    NotebookUpdateRequest,
    ResourceStatus,
)
from orbis_user_api.services.document_group import get_default_document_group
from orbis_user_api.services.exceptions import (
    ArchiveRestoreDependencyInactive,
    DocumentGroupNotFound,
    NotebookNotFound,
)
from orbis_user_api.services.workspace import get_current_workspace


async def list_notebooks(
    user: User,
    session: AsyncSession,
    group_id: UUID | None = None,
    resource_status: ResourceStatus = "active",
    include_inactive_parents: bool = False,
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[Notebook], int]:
    workspace, _ = await get_current_workspace(user, session)
    conditions = [
        Notebook.workspace_id == workspace.id,
        Notebook.status == resource_status,
    ]
    if group_id is not None:
        conditions.append(Notebook.group_id == group_id)
    if resource_status == "active" and not include_inactive_parents:
        conditions.append(NoteGroup.status == "active")
    total = await session.scalar(
        select(func.count(Notebook.id))
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(*conditions)
    )
    result = await session.execute(
        select(Notebook)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(*conditions)
        .order_by(Notebook.sort_order.asc(), Notebook.created_at_ms.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all()), int(total or 0)


async def create_notebook(
    payload: NotebookCreateRequest, user: User, session: AsyncSession
) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    group_id = payload.group_id
    if group_id is None:
        group = await get_default_document_group(session, workspace)
        group_id = group.id
    else:
        group = await session.get(NoteGroup, group_id)
        if (
            group is None
            or group.workspace_id != workspace.id
            or group.status != "active"
        ):
            raise DocumentGroupNotFound

    notebook = Notebook(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        group_id=group_id,
        owner_id=user.id,
        title=payload.title.strip(),
        sort_order=payload.sort_order,
    )
    session.add(notebook)
    await session.commit()
    await session.refresh(notebook)
    return notebook


async def set_notebook_archived(
    notebook_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await session.get(Notebook, notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != workspace.id
        or notebook.status not in {"active", "archived"}
    ):
        raise NotebookNotFound
    if not archived:
        group = await session.get(NoteGroup, notebook.group_id)
        if (
            group is None
            or group.workspace_id != workspace.id
            or group.status != "active"
        ):
            raise ArchiveRestoreDependencyInactive
    notebook.status = "archived" if archived else "active"
    notebook.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(notebook)
    return notebook


async def update_notebook(
    notebook_id: UUID,
    payload: NotebookUpdateRequest,
    user: User,
    session: AsyncSession,
) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await session.get(Notebook, notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != workspace.id
        or notebook.status != "active"
    ):
        raise NotebookNotFound

    if "group_id" in payload.model_fields_set:
        if payload.group_id is None:
            group = await get_default_document_group(session, workspace)
        else:
            group = await session.get(NoteGroup, payload.group_id)
            if (
                group is None
                or group.workspace_id != workspace.id
                or group.status != "active"
            ):
                raise DocumentGroupNotFound
        notebook.group_id = group.id
    if payload.title is not None:
        notebook.title = payload.title.strip()
    if payload.sort_order is not None:
        notebook.sort_order = payload.sort_order
    notebook.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(notebook)
    return notebook


async def get_notebook(
    notebook_id: UUID, user: User, session: AsyncSession
) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await session.get(Notebook, notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != workspace.id
        or notebook.status != "active"
    ):
        raise NotebookNotFound
    return notebook
