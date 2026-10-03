from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter, PaginationParams
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.search import search
from orbis_user_api.models.user import User
from orbis_user_api.schemas.search import (
    SearchPage,
    SearchScope,
    SearchStatus,
    SearchTypeFilter,
)
from orbis_user_api.services.exceptions import UserWorkspaceMissing

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
            description="普通文本关键词，不展开 SQL 通配符；空白仅返回当前空间信息，指定 resource_id 时允许按 ID 定位",
        ),
    ] = "",
    scope: Annotated[
        SearchScope,
        Query(
            description="兼容旧参数，已停用；无论取值如何，仅检索 X-Workspace-ID 解析出的当前空间",
            deprecated=True,
        ),
    ] = "current",
    workspace_id: Annotated[
        UUID | None,
        Query(
            description="兼容旧参数，已停用；不改变当前请求空间，空间上下文仅由 X-Workspace-ID 决定",
            deprecated=True,
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
    try:
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
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=403,
            code="SEARCH_WORKSPACE_FORBIDDEN",
            message="需要当前工作空间的有效读取权限",
        ) from None
