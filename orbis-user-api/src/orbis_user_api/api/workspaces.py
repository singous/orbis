from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.models.user import User
from orbis_user_api.schemas.workspace import (
    WorkspaceListResponse,
    WorkspaceSwitchRequest,
    WorkspaceSwitchResponse,
)
from orbis_user_api.services.exceptions import UserWorkspaceMissing
from orbis_user_api.services.workspace import (
    accessible_workspaces,
    get_current_workspace,
    switch_workspace,
    workspace_payload,
)

logger = logging.getLogger(__name__)
router = ApiRouter(tags=["workspace"])


@router.get(
    "/workspaces", response_model=WorkspaceListResponse, summary="查询可访问工作空间"
)
async def list_workspaces(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceListResponse:
    rows = await accessible_workspaces(user, session)
    try:
        current, _ = await get_current_workspace(user, session)
    except UserWorkspaceMissing:
        current_id = None
    else:
        current_id = current.id
    return WorkspaceListResponse(
        items=[
            workspace_payload(
                workspace, membership, user, current_workspace_id=current_id
            )
            for workspace, membership in rows
        ]
    )


@router.post(
    "/workspace/switch",
    response_model=WorkspaceSwitchResponse,
    summary="切换当前工作空间",
)
async def select_workspace(
    payload: WorkspaceSwitchRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceSwitchResponse:
    workspace, membership = await switch_workspace(payload.workspace_id, user, session)
    logger.info(
        "Current workspace changed: actor_id=%s workspace_id=%s", user.id, workspace.id
    )
    return WorkspaceSwitchResponse(
        user=user, workspace=workspace_payload(workspace, membership, user)
    )
