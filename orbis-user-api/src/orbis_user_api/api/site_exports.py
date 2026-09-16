"""Anonymous active-release delivery, crawlable pages and machine exports."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    PlainTextResponse,
    RedirectResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application import site_delivery as delivery
from orbis_user_api.application import site_exports as exports
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_html import built_asset, error_html, render_site
from orbis_user_api.schemas.site import SiteSnapshotOut
from orbis_user_api.schemas.site_delivery import (
    SiteManifestOut,
    SitePageDeliveryOut,
    SiteSearchOut,
)

router = ApiRouter(tags=["public-sites"])
export_router = APIRouter(tags=["public-sites"])
web_router = APIRouter(include_in_schema=False)
NO_STORE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
ExpectedRelease = Annotated[
    UUID | None,
    Query(description="期望的活动发布版本 UUID；已切换时返回 409，请刷新后重试"),
]
Session = Annotated[AsyncSession, Depends(get_session)]


def api_error(error: SiteError) -> ApiError:
    return ApiError(
        status_code=error.status_code,
        code=error.code,
        message=error.message,
        headers=NO_STORE,
    )


async def current_snapshot(
    slug: str,
    request: Request,
    session: Session,
    expected_release_id: ExpectedRelease = None,
) -> SiteSnapshotOut:
    try:
        if b"%25" in request.scope.get("raw_path", b"").lower():
            raise delivery.missing_page()
        return await delivery.active_snapshot(slug, session, expected_release_id)
    except SiteError as error:
        raise api_error(error) from None


Snapshot = Annotated[SiteSnapshotOut, Depends(current_snapshot)]


@router.get(
    "/public/sites/{slug}/manifest",
    response_model=SiteManifestOut,
    summary="读取公开站点导航清单",
)
async def manifest(snapshot: Snapshot, request: Request, response: Response):
    response.headers.update(NO_STORE)
    return delivery.manifest(
        snapshot, base_url(request) + exports.site_path(snapshot.slug)
    )


@router.get(
    "/public/sites/{slug}/search",
    response_model=SiteSearchOut,
    summary="读取当前版本的公开搜索索引",
)
async def search(snapshot: Snapshot, response: Response):
    response.headers.update(NO_STORE)
    return delivery.search_index(snapshot)


@router.get(
    "/public/sites/{slug}/pages/{page_slug:path}",
    response_model=SitePageDeliveryOut,
    summary="读取当前版本的单页正文",
)
async def page(page_slug: str, snapshot: Snapshot, response: Response):
    response.headers.update(NO_STORE)
    try:
        return delivery.page_delivery(snapshot, page_slug)
    except SiteError as error:
        raise api_error(error) from None


def base_url(request: Request) -> str:
    return exports.canonical_base(request.app.state.settings.user_web_base_url)


@export_router.get(
    "/s/{slug}/sitemap.xml",
    response_class=Response,
    summary="读取公开站点 XML 站点地图",
    responses={200: {"content": {"application/xml": {"schema": {"type": "string"}}}}},
)
async def sitemap(snapshot: Snapshot, request: Request):
    return Response(
        exports.sitemap(snapshot, base_url(request)),
        media_type="application/xml",
        headers=NO_STORE,
    )


@export_router.get(
    "/s/{slug}/robots.txt",
    response_class=PlainTextResponse,
    summary="读取公开站点抓取规则",
)
async def robots(snapshot: Snapshot, request: Request):
    return PlainTextResponse(
        exports.robots(snapshot, base_url(request)), headers=NO_STORE
    )


@export_router.get(
    "/s/{slug}/llms.txt",
    response_class=PlainTextResponse,
    summary="读取公开站点机器阅读目录",
)
async def llms(snapshot: Snapshot, request: Request):
    return PlainTextResponse(
        exports.llms(snapshot, base_url(request)), headers=NO_STORE
    )


@export_router.get(
    "/s/{slug}/llms-full.txt",
    response_class=PlainTextResponse,
    summary="读取公开站点完整 Markdown 文档集",
)
async def llms_full(snapshot: Snapshot, request: Request):
    return PlainTextResponse(
        exports.llms_full(snapshot, base_url(request)), headers=NO_STORE
    )


@export_router.get(
    "/s/{slug}/pages/{page_slug:path}.md",
    response_class=Response,
    summary="读取当前公开页面的 Markdown",
    responses={200: {"content": {"text/markdown": {"schema": {"type": "string"}}}}},
)
async def markdown(page_slug: str, snapshot: Snapshot, request: Request):
    try:
        selected = delivery.find_page(snapshot, page_slug)
    except SiteError as error:
        raise api_error(error) from None
    return Response(
        exports.page_markdown(selected, base_url(request)),
        media_type="text/markdown",
        headers=NO_STORE,
    )


@web_router.get("/robots.txt")
async def root_robots():
    return PlainTextResponse(
        "User-agent: *\nAllow: /s/\nDisallow: /\n", headers=NO_STORE
    )


@web_router.get("/assets/{asset_path:path}")
async def reader_asset(asset_path: str, request: Request):
    asset = built_asset(request.app.state.settings.user_web_dist_dir, asset_path)
    if asset is None:
        raise ApiError(
            status_code=404,
            code="RESOURCE_NOT_FOUND",
            message="静态资源不存在",
            headers=NO_STORE,
        )
    return FileResponse(
        asset,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@web_router.get("/s/{slug}", response_class=HTMLResponse)
@web_router.get("/s/{slug}/{page_slug:path}", response_class=HTMLResponse)
async def site_html(
    slug: str, request: Request, session: Session, page_slug: str | None = None
):
    try:
        if b"%25" in request.scope.get("raw_path", b"").lower():
            raise delivery.missing_page()
        snapshot = await delivery.active_snapshot(slug, session)
        target = delivery.redirect_target(snapshot, page_slug)
        if target:
            return RedirectResponse(
                exports.site_path(snapshot.slug, target),
                status_code=307,
                headers=NO_STORE,
            )
        selected = delivery.find_page(snapshot, page_slug)
        return HTMLResponse(
            render_site(
                snapshot,
                selected,
                base_url(request),
                request.app.state.settings.user_web_dist_dir,
            ),
            headers=NO_STORE,
        )
    except SiteError as error:
        return HTMLResponse(
            error_html(error.message),
            status_code=error.status_code,
            headers={**NO_STORE, "X-Robots-Tag": "noindex, nofollow"},
        )
