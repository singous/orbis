from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Body, Depends, Path, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import (
    ApiRouter,
    PageData,
    PaginationParams,
    build_page_data,
)
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application import sites
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.domain.site import SLUG_PATTERN
from orbis_user_api.models.user import User
from orbis_user_api.schemas.site import (
    SiteCreateRequest,
    SiteOut,
    SitePreviewOut,
    SiteReleaseOut,
    SiteSnapshotOut,
    SiteUpdateRequest,
)
from orbis_user_api.schemas.site_source import SitePublishRequest, SiteSourcesOut
from orbis_user_api.services.exceptions import (
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

router = ApiRouter(tags=["sites"])
public_router = ApiRouter(tags=["public-sites"])
logger = logging.getLogger(__name__)


def _public_url_policy(request: Request) -> PublicUrlPolicy:
    return PublicUrlPolicy.for_app(
        str(request.base_url), request.app.state.settings.user_web_base_url
    )


@contextmanager
def _site_errors() -> Iterator[None]:
    try:
        yield
    except SiteError as error:
        logger.info("Site request rejected: code=%s", error.code)
        raise ApiError(
            status_code=error.status_code, code=error.code, message=error.message
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=403,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None
    except WorkspaceMemberForbidden:
        raise ApiError(
            status_code=403,
            code="RESOURCE_MANAGE_FORBIDDEN",
            message="需要内容管理权限",
        ) from None


@router.get("/sites", response_model=PageData[SiteOut], summary="分页查询站点")
async def list_sites(
    pagination: Annotated[PaginationParams, Depends()],
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        items, total = await sites.list_sites(
            user, session, offset=pagination.offset, limit=pagination.page_size
        )
        return build_page_data(
            items, page=pagination.page, page_size=pagination.page_size, total=total
        )


@router.post("/sites", response_model=SiteOut, status_code=201, summary="创建站点")
async def create_site(
    payload: SiteCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        return await sites.create_site(payload, user, session)


@router.get("/sites/{site_id}", response_model=SiteOut, summary="读取站点配置")
async def get_site(
    site_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        return await sites.get_site(site_id, user, session)


@router.put("/sites/{site_id}", response_model=SiteOut, summary="保存站点完整配置")
async def update_site(
    site_id: UUID,
    payload: SiteUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        return await sites.update_site(site_id, payload, user, session)


@router.get(
    "/sites/{site_id}/preview", response_model=SitePreviewOut, summary="预览待发布站点"
)
async def preview_site(
    site_id: UUID,
    request: Request,
    url_policy: Annotated[PublicUrlPolicy, Depends(_public_url_policy)],
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    with _site_errors():
        return await sites.preview_site(
            site_id,
            user,
            session,
            url_policy=url_policy,
            storage=request.app.state.storage,
        )


@router.get(
    "/sites/{site_id}/sources",
    response_model=SiteSourcesOut,
    summary="解析站点来源与待发布变化",
)
async def get_site_sources(
    site_id: UUID,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    response.headers["Cache-Control"] = "no-store"
    with _site_errors():
        return await sites.get_site_sources(site_id, user, session)


@router.post(
    "/sites/{site_id}/publish",
    response_model=SiteSnapshotOut,
    summary="发布站点不可变快照",
)
async def publish_site(
    site_id: UUID,
    request: Request,
    url_policy: Annotated[PublicUrlPolicy, Depends(_public_url_policy)],
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    payload: Annotated[SitePublishRequest, Body(default_factory=SitePublishRequest)],
):
    with _site_errors():
        return await sites.publish_site(
            site_id,
            user,
            session,
            url_policy=url_policy,
            storage=request.app.state.storage,
            expected_source_fingerprint=payload.expected_source_fingerprint,
        )


@router.get(
    "/sites/{site_id}/releases",
    response_model=PageData[SiteReleaseOut],
    summary="分页查询站点发布历史",
)
async def list_releases(
    site_id: UUID,
    pagination: Annotated[PaginationParams, Depends()],
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        items, total = await sites.list_releases(
            site_id, user, session, offset=pagination.offset, limit=pagination.page_size
        )
        return build_page_data(
            items, page=pagination.page, page_size=pagination.page_size, total=total
        )


@router.post(
    "/sites/{site_id}/releases/{release_id}/activate",
    response_model=SiteOut,
    summary="切换站点公开版本",
)
async def activate_release(
    site_id: UUID,
    release_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        return await sites.activate_release(site_id, release_id, user, session)


@router.post(
    "/sites/{site_id}/unpublish", response_model=SiteOut, summary="撤回公开站点"
)
async def unpublish_site(
    site_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    with _site_errors():
        return await sites.unpublish_site(site_id, user, session)


@public_router.get(
    "/public/sites/{slug}", response_model=SiteSnapshotOut, summary="匿名读取已发布站点"
)
async def read_public_site(
    response: Response,
    slug: Annotated[str, Path(pattern=SLUG_PATTERN, min_length=1, max_length=80)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    response.headers["Cache-Control"] = "no-store"
    with _site_errors():
        return await sites.read_public_site(slug, session)
