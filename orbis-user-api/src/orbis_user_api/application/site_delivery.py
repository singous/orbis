"""Project every delivery format from the same active public snapshot."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.sites import read_public_site
from orbis_user_api.domain.site import PAGE_SLUG_PATTERN, SLUG_PATTERN
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut
from orbis_user_api.schemas.site_delivery import (
    SiteManifestOut,
    SitePageDeliveryOut,
    SiteSearchOut,
)


def missing_page() -> SiteError:
    return SiteError("SITE_PAGE_NOT_FOUND", "公开页面不存在或尚未发布", 404)


async def active_snapshot(
    slug: str,
    session: AsyncSession,
    expected_release_id: UUID | None = None,
) -> SiteSnapshotOut:
    if not re.fullmatch(SLUG_PATTERN, slug):
        raise SiteError("SITE_NOT_FOUND", "站点不存在或尚未发布", 404)
    snapshot = await read_public_site(slug, session)
    if expected_release_id is not None and snapshot.release_id != expected_release_id:
        raise SiteError(
            "SITE_RELEASE_CHANGED", "站点发布版本已更新，请刷新页面后重试", 409
        )
    return snapshot


def manifest(snapshot: SiteSnapshotOut, canonical_base_url: str) -> SiteManifestOut:
    return SiteManifestOut.model_validate(
        {**snapshot.model_dump(), "canonical_base_url": canonical_base_url}
    )


def find_page(snapshot: SiteSnapshotOut, slug: str | None) -> SitePageOut:
    if slug is None and snapshot.pages:
        return snapshot.pages[0]
    if slug is not None and re.fullmatch(PAGE_SLUG_PATTERN, slug):
        for page in snapshot.pages:
            if page.slug == slug:
                return page
    raise missing_page()


def redirect_target(snapshot: SiteSnapshotOut, slug: str | None) -> str | None:
    if slug is None or not re.fullmatch(PAGE_SLUG_PATTERN, slug):
        return None
    # A current canonical page always wins over old aliases.
    if any(page.slug == slug for page in snapshot.pages):
        return None
    target = snapshot.redirects.get(slug)
    if (
        target
        and re.fullmatch(PAGE_SLUG_PATTERN, target)
        and any(page.slug == target for page in snapshot.pages)
    ):
        return target
    return None


def page_delivery(snapshot: SiteSnapshotOut, slug: str | None) -> SitePageDeliveryOut:
    return SitePageDeliveryOut(
        release_id=snapshot.release_id, page=find_page(snapshot, slug)
    )


def search_index(snapshot: SiteSnapshotOut) -> SiteSearchOut:
    return SiteSearchOut.model_validate(
        {
            "release_id": snapshot.release_id,
            "pages": [page.model_dump() for page in snapshot.pages],
        }
    )
