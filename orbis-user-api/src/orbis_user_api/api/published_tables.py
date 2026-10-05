"""Active-release and authorized preview access to frozen table pages."""

from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.data_tables import table_errors
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.published_tables import (
    private_snapshot,
    public_snapshot,
    snapshot_page,
    snapshot_html,
)
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.models.user import User

router = ApiRouter(tags=["data-tables"])
html_router = APIRouter(tags=["data-tables"])


@asynccontextmanager
async def errors(session):
    async with table_errors(session):
        try:
            yield
        except SiteError as error:
            raise ApiError(
                status_code=error.status_code, code=error.code, message=error.message
            ) from None


@router.get(
    "/table-snapshots/{snapshot_id}",
    response_model=dict[str, Any],
    summary="读取当前空间站点预览中的表格快照页",
)
async def preview_table(
    snapshot_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with errors(session):
        snapshot = await private_snapshot(session, snapshot_id, user)
        return await snapshot_page(session, snapshot, offset, limit)


@router.get(
    "/public/sites/{slug}/table-snapshots/{snapshot_id}",
    response_model=dict[str, Any],
    summary="分页读取活动发布版本中的多维表格快照",
)
async def public_table(
    slug: str,
    snapshot_id: UUID,
    expected_release_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    async with errors(session):
        snapshot, release = await public_snapshot(
            session, slug, snapshot_id, expected_release_id
        )
        return {
            **await snapshot_page(session, snapshot, offset, limit),
            "release_id": str(release),
        }


@html_router.get(
    "/public/sites/{slug}/table-snapshots/{snapshot_id}/html",
    summary="无 JavaScript 阅读表格快照",
    response_class=HTMLResponse,
)
async def public_table_html(
    slug: str,
    snapshot_id: UUID,
    expected_release_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    async with errors(session):
        snapshot, release = await public_snapshot(
            session, slug, snapshot_id, expected_release_id
        )
        data = await snapshot_page(session, snapshot, offset, 100)
        path = f"/public/sites/{slug}/table-snapshots/{snapshot_id}/html?expected_release_id={release}"
        return HTMLResponse(
            snapshot_html(data, path), headers={"Cache-Control": "no-store"}
        )
