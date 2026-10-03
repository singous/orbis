from __future__ import annotations

import logging
from time import perf_counter
from uuid import UUID

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import PaginationParams, build_page_data
from orbis_user_api.api.errors import ApiError
from orbis_user_api.models.user import User
from orbis_user_api.schemas.search import (
    SearchItem,
    SearchPage,
    SearchResolvedScope,
    SearchScope,
    SearchStatus,
    SearchTypeFilter,
    SearchWorkspace,
)

from . import assets, documents
from .projection import snippet
from orbis_user_api.services.authorization import AuthorizationService

logger = logging.getLogger(__name__)

PROVIDERS = {
    "document": documents.documents,
    "notebook": documents.notebooks,
    "group": documents.groups,
    "site": assets.sites,
    "file": assets.files,
}


async def search(
    *,
    query: str,
    scope: SearchScope,
    workspace_id: UUID | None,
    resource_type: SearchTypeFilter,
    resource_id: UUID | None,
    resource_status: SearchStatus,
    pagination: PaginationParams,
    user: User,
    session: AsyncSession,
) -> SearchPage:
    started = perf_counter()
    if resource_id is not None and resource_type == "all":
        raise ApiError(
            status_code=422,
            code="SEARCH_RESOURCE_TYPE_REQUIRED",
            message="按资源 ID 定位时必须指定具体资源类型",
        )
    # Legacy query parameters remain accepted but cannot override the app context.
    workspace, membership = await AuthorizationService.actor(user, session)
    workspaces = [(workspace, membership)]
    workspace_ids = [workspace.id]
    names = {workspace.id: workspace.name for workspace, _ in workspaces}
    normalized = query.strip()
    items = []
    total = 0
    if normalized or resource_id is not None:
        providers = (
            PROVIDERS.values()
            if resource_type == "all"
            else (PROVIDERS[resource_type],)
        )
        statements = [
            provider(normalized, workspace_ids, resource_status)
            for provider in providers
        ]
        matches = union_all(*statements).subquery("search_matches")
        if resource_id is not None:
            matches = (
                select(matches)
                .where(matches.c.id == resource_id)
                .subquery("search_target")
            )
        total = int(
            await session.scalar(select(func.count()).select_from(matches)) or 0
        )
        result = await session.execute(
            select(matches)
            .order_by(
                matches.c.rank.asc(),
                matches.c.updated_at_ms.desc(),
                matches.c.type.asc(),
                matches.c.id.asc(),
            )
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
        for row in result.mappings():
            values = dict(row)
            values.pop("rank")
            values["snippet"] = snippet(values.pop("snippet_source") or "", normalized)
            values["workspace_name"] = names[values["workspace_id"]]
            items.append(SearchItem(**values))
    page = build_page_data(
        items, page=pagination.page, page_size=pagination.page_size, total=total
    )
    logger.info(
        "Workspace search completed: actor_id=%s scope_count=%s type=%s status=%s results=%s duration_ms=%.1f",
        user.id,
        len(workspace_ids),
        resource_type,
        resource_status,
        total,
        (perf_counter() - started) * 1000,
    )
    return SearchPage(
        items=page.items,
        pagination=page.pagination,
        scope=SearchResolvedScope(
            workspace_ids=workspace_ids, current_workspace_id=workspace_ids[0]
        ),
        workspaces=[
            SearchWorkspace(
                id=workspace.id,
                name=workspace.name,
                is_current=True,
            )
            for workspace, _ in workspaces
        ],
    )
