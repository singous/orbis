from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter, PaginationParams
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.search import search
from orbis_user_api.application.search.scope import accessible_workspaces
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import User
from orbis_user_api.schemas.search import (
    SearchPage,
    SearchScope,
    SearchStatus,
    SearchTypeFilter,
    WorkspaceSwitchRequest,
    WorkspaceSwitchResponse,
)
from orbis_user_api.services.workspace import workspace_payload

logger = logging.getLogger(__name__)
router = ApiRouter()


@router.get(
    "/search", response_model=SearchPage, tags=["search"], summary="全局搜索可访问资源"
)
async def global_search(
    pagination: Annotated[PaginationParams, Depends()],
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[
        str,
        Query(
            max_length=240,
            description="普通文本关键词，不展开 SQL 通配符；空白仅返回可选空间，指定 resource_id 时允许按 ID 定位",
        ),
    ] = "",
    scope: Annotated[
        SearchScope, Query(description="默认当前空间，all 显式检索所有可读空间")
    ] = "current",
    workspace_id: Annotated[
        UUID | None,
        Query(
            description="显式指定一个可读空间；不改变当前空间，不能与 scope=all 同用",
        ),
    ] = None,
    resource_type: Annotated[
        SearchTypeFilter,
        Query(alias="type", description="资源类型；评论命中合并到 document"),
    ] = "all",
    resource_id: Annotated[
        UUID | None,
        Query(
            description="精确定位资源 UUID；必须同时指定具体 type，仍校验空间、状态与读取权限"
        ),
    ] = None,
    resource_status: Annotated[
        SearchStatus,
        Query(
            alias="status",
            description="资源状态；默认仅完整活跃路径，archived 不包括站点或文件",
        ),
    ] = "active",
) -> SearchPage:
    return await search(
        query=q,
        scope=scope,
        workspace_id=workspace_id,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_status=resource_status,
        pagination=pagination,
        user=user,
        session=session,
    )


@router.post(
    "/workspace/switch",
    response_model=WorkspaceSwitchResponse,
    tags=["workspace"],
    summary="切换当前工作空间",
)
async def switch_workspace(
    payload: WorkspaceSwitchRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WorkspaceSwitchResponse:
    rows = await accessible_workspaces(user, session)
    selected = next((row for row in rows if row[0].id == payload.workspace_id), None)
    if selected is None:
        raise ApiError(
            status_code=403,
            code="SEARCH_WORKSPACE_FORBIDDEN",
            message="需要所选工作空间的有效读取权限",
        )
    workspace, membership = selected
    if user.current_workspace_id != workspace.id:
        user.current_workspace_id = workspace.id
        user.updated_at_ms = now_ms()
        await session.commit()
        await session.refresh(user)
    logger.info(
        "Current workspace changed: actor_id=%s workspace_id=%s", user.id, workspace.id
    )
    return WorkspaceSwitchResponse(
        user=user, workspace=workspace_payload(workspace, membership, user)
    )
