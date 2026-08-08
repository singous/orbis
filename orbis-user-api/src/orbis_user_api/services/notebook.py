from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.note import NoteGroup, Notebook
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import NotebookCreateRequest
from orbis_user_api.services.document_group import get_default_document_group
from orbis_user_api.services.exceptions import DocumentGroupNotFound, NotebookNotFound
from orbis_user_api.services.workspace import get_current_workspace


async def list_notebooks(user: User, session: AsyncSession, group_id: UUID | None = None) -> list[Notebook]:
    workspace, _ = await get_current_workspace(user, session)
    conditions = [Notebook.workspace_id == workspace.id, Notebook.status == "active"]
    if group_id is not None:
        conditions.append(Notebook.group_id == group_id)
    result = await session.execute(
        select(Notebook).where(*conditions).order_by(Notebook.sort_order.asc(), Notebook.created_at_ms.asc())
    )
    return list(result.scalars().all())


async def create_notebook(payload: NotebookCreateRequest, user: User, session: AsyncSession) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    group_id = payload.group_id
    if group_id is None:
        group = await get_default_document_group(session, workspace)
        group_id = group.id
    else:
        group = await session.get(NoteGroup, group_id)
        if group is None or group.workspace_id != workspace.id or group.status != "active":
            raise DocumentGroupNotFound

    notebook = Notebook(
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


async def get_notebook(notebook_id: UUID, user: User, session: AsyncSession) -> Notebook:
    workspace, _ = await get_current_workspace(user, session)
    notebook = await session.get(Notebook, notebook_id)
    if notebook is None or notebook.workspace_id != workspace.id or notebook.status != "active":
        raise NotebookNotFound
    return notebook
