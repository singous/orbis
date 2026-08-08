from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.models.user import User
from orbis_user_api.schemas.workspace import (
    WorkspaceCurrentUpdateRequest,
    WorkspaceListResponse,
    WorkspaceMemberCreateRequest,
    WorkspaceMemberListResponse,
    WorkspaceMemberOut,
    WorkspaceOut,
)
from orbis_user_api.services.exceptions import (
    WorkspaceMemberAlreadyExists,
    WorkspaceMemberForbidden,
    WorkspaceMemberNotFound,
    WorkspaceNotFound,
    WorkspaceOwnerRemovalForbidden,
)
from orbis_user_api.services.workspace import (
    add_workspace_member,
    get_current_workspace_payload,
    list_workspace_members,
    list_workspaces,
    remove_workspace_member,
    switch_current_workspace,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=WorkspaceListResponse)
async def get_workspaces(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceListResponse:
    return WorkspaceListResponse(items=await list_workspaces(user, session))


@router.get("/current", response_model=WorkspaceOut)
async def current_workspace(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    return await get_current_workspace_payload(user, session)


@router.put("/current", response_model=WorkspaceOut)
async def update_current_workspace(
    payload: WorkspaceCurrentUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await switch_current_workspace(payload.workspace_id, user, session)
    except WorkspaceNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found") from None


@router.get("/{workspace_id}/members", response_model=WorkspaceMemberListResponse)
async def workspace_members(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMemberListResponse:
    try:
        return WorkspaceMemberListResponse(items=await list_workspace_members(workspace_id, user, session))
    except WorkspaceNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found") from None


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberOut, status_code=status.HTTP_201_CREATED)
async def create_workspace_member(
    workspace_id: UUID,
    payload: WorkspaceMemberCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await add_workspace_member(workspace_id, str(payload.email), user, session)
    except WorkspaceNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found") from None
    except WorkspaceMemberForbidden:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace member operation forbidden") from None
    except WorkspaceMemberNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found") from None
    except WorkspaceMemberAlreadyExists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workspace member already exists") from None


@router.delete("/{workspace_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_member(
    workspace_id: UUID,
    member_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await remove_workspace_member(workspace_id, member_id, user, session)
    except WorkspaceNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found") from None
    except WorkspaceMemberForbidden:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace member operation forbidden") from None
    except WorkspaceMemberNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found") from None
    except WorkspaceOwnerRemovalForbidden:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workspace owner removal forbidden") from None
