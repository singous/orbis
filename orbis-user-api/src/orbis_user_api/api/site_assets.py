from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from orbis_user_api.api.deps import get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.site_assets import (
    active_public_asset,
    public_asset_response,
)
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.domain.site import SLUG_PATTERN

router = APIRouter(tags=["public-sites"])


async def read_public_site_asset(
    request: Request,
    slug: Annotated[str, Path(pattern=SLUG_PATTERN, min_length=1, max_length=80)],
    key: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FileResponse:
    try:
        asset = await active_public_asset(slug, key, session)
        return await run_in_threadpool(
            public_asset_response, asset, request.app.state.storage
        )
    except SiteError as error:
        raise ApiError(
            status_code=error.status_code,
            code=error.code,
            message=error.message,
        ) from None


router.add_api_route(
    "/public/sites/{slug}/assets/{key}",
    read_public_site_asset,
    methods=["GET"],
    response_class=FileResponse,
    response_model=None,
    summary="读取公开站点资源",
    responses={
        200: {
            "description": "当前活动发布版本引用的文件二进制内容",
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
