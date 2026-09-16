from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_changes import source_changes
from orbis_user_api.application.site_errors import (
    SiteError,
    site_slug_conflict,
    site_version_conflict,
)
from orbis_user_api.application.site_navigation import PagePaths
from orbis_user_api.application.site_slugs import (
    release_unused_site_slugs,
    reserve_site_slug,
)
from orbis_user_api.application.site_snapshots import (
    build_snapshot,
)
from orbis_user_api.application.site_sources import resolve_site_source
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.site import Site, SiteRelease
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import WorkspaceMember
from orbis_user_api.schemas.site import (
    SiteCreateRequest,
    SiteOut,
    SitePreviewOut,
    SiteReleaseOut,
    SiteSnapshotOut,
    SiteUpdateRequest,
)
from orbis_user_api.schemas.site_source import SiteSource, SiteSourcesOut
from orbis_user_api.services.authorization import AuthorizationService, Capability

logger = logging.getLogger(__name__)
PUBLISH_ROLES = frozenset({"owner", "admin"})


async def _site_actor(
    site_id: UUID, user: User, session: AsyncSession
) -> tuple[Site, WorkspaceMember]:
    workspace, member = await AuthorizationService.actor(user, session)
    site = await session.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise SiteError("SITE_NOT_FOUND", "站点不存在", 404)
    return site, member


def _require_publisher(member: WorkspaceMember) -> None:
    if member.role not in PUBLISH_ROLES:
        raise SiteError(
            "SITE_PUBLISH_FORBIDDEN",
            "仅所有者和管理员可以发布、切换版本或撤回站点",
            403,
        )


async def _require_available_slug(
    slug: str, session: AsyncSession, site_id: UUID | None = None
) -> None:
    query = select(Site.id).where(or_(Site.slug == slug, Site.published_slug == slug))
    if site_id is not None:
        query = query.where(Site.id != site_id)
    if await session.scalar(query.limit(1)) is not None:
        raise site_slug_conflict()


async def list_sites(
    user: User, session: AsyncSession, *, offset: int, limit: int
) -> tuple[list[SiteOut], int]:
    workspace, _ = await AuthorizationService.actor(user, session)
    predicate = Site.workspace_id == workspace.id
    total = await session.scalar(
        select(func.count()).select_from(Site).where(predicate)
    )
    sites = await session.scalars(
        select(Site)
        .where(predicate)
        .order_by(Site.updated_at_ms.desc(), Site.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [SiteOut.model_validate(site) for site in sites], total or 0


async def create_site(
    payload: SiteCreateRequest, user: User, session: AsyncSession
) -> Site:
    workspace, member = await AuthorizationService.actor(user, session)
    AuthorizationService.require_capability(member, Capability.RESOURCE_MANAGE)
    await _require_available_slug(payload.slug, session)
    site = Site(
        id=new_uuidv7(), workspace_id=workspace.id, **payload.model_dump(mode="json")
    )
    await resolve_site_source(site, session)
    session.add(site)
    await reserve_site_slug(site.id, site.slug, session)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise site_slug_conflict() from None
    await session.refresh(site)
    logger.info(
        "Site created: site_id=%s workspace_id=%s actor_id=%s",
        site.id,
        workspace.id,
        user.id,
    )
    return site


async def get_site(site_id: UUID, user: User, session: AsyncSession) -> Site:
    site, _ = await _site_actor(site_id, user, session)
    return site


async def update_site(
    site_id: UUID, payload: SiteUpdateRequest, user: User, session: AsyncSession
) -> Site:
    site, member = await _site_actor(site_id, user, session)
    AuthorizationService.require_capability(member, Capability.RESOURCE_MANAGE)
    if site.config_version != payload.expected_version:
        raise site_version_conflict()
    await _require_available_slug(payload.slug, session, site.id)
    values = payload.model_dump(mode="json", exclude={"expected_version"})
    # Older clients do not know these additive settings. An omitted field must
    # preserve it instead of resetting it to a schema default.
    for field in ("source", "branding"):
        if field not in payload.model_fields_set:
            values[field] = getattr(site, field)
    registry = PagePaths(site.page_registry or {})
    if (
        SiteSource.model_validate(site.source or {}).kind == "manual"
        and SiteSource.model_validate(values["source"]).kind == "notebooks"
    ):
        # Old releases have no registry. Preserve configured addresses when
        # moving from explicit selection to notebook-driven navigation.
        for entry in site.navigation:
            registry.assign(entry["note_id"], entry["title"], entry["slug"])
    candidate = Site(
        id=site.id,
        workspace_id=site.workspace_id,
        page_registry=registry.registry,
        **values,
    )
    await resolve_site_source(candidate, session)
    try:
        result = await session.execute(
            update(Site)
            .where(
                Site.id == site.id,
                Site.config_version == payload.expected_version,
                Site.release_sequence == site.release_sequence,
            )
            .values(
                **values,
                page_registry=registry.registry,
                config_version=Site.config_version + 1,
                updated_at_ms=now_ms(),
            )
            .returning(Site.id)
            .execution_options(synchronize_session=False)
        )
        if result.scalar_one_or_none() is None:
            await session.rollback()
            raise site_version_conflict()
        await reserve_site_slug(site.id, payload.slug, session)
        await release_unused_site_slugs(site.id, session)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise site_slug_conflict() from None
    await session.refresh(site)
    logger.info(
        "Site configuration saved: site_id=%s config_version=%s actor_id=%s",
        site.id,
        site.config_version,
        user.id,
    )
    return site


async def preview_site(
    site_id: UUID, user: User, session: AsyncSession, *, url_policy: PublicUrlPolicy
) -> SitePreviewOut:
    site, _ = await _site_actor(site_id, user, session)
    before = await resolve_site_source(site, session)
    snapshot = await build_snapshot(site, session, url_policy=url_policy)
    after = await resolve_site_source(site, session)
    if before.fingerprint != after.fingerprint:
        raise SiteError(
            "SITE_SOURCE_CONFLICT", "预览期间来源内容已变化，请重新预览", 409
        )
    return SitePreviewOut(**snapshot.model_dump(), source_fingerprint=after.fingerprint)


async def get_site_sources(
    site_id: UUID, user: User, session: AsyncSession
) -> SiteSourcesOut:
    site, _ = await _site_actor(site_id, user, session)
    resolved = await resolve_site_source(site, session)
    release = (
        await session.get(SiteRelease, site.published_release_id)
        if site.published_release_id
        else None
    )
    return SiteSourcesOut(
        pages=[page.metadata for page in resolved.pages],
        excluded_count=resolved.excluded_count,
        source_fingerprint=resolved.fingerprint,
        changes=source_changes(resolved, release),
    )


async def publish_site(
    site_id: UUID,
    user: User,
    session: AsyncSession,
    *,
    url_policy: PublicUrlPolicy,
    expected_source_fingerprint: str | None = None,
) -> SiteSnapshotOut:
    site, member = await _site_actor(site_id, user, session)
    _require_publisher(member)
    source = SiteSource.model_validate(site.source or {})
    before = await resolve_site_source(site, session)
    if source.kind == "notebooks" and expected_source_fingerprint is None:
        raise SiteError(
            "SITE_PREVIEW_REQUIRED", "请先预览本次来源变化，再确认发布", 422
        )
    if (
        expected_source_fingerprint is not None
        and expected_source_fingerprint != before.fingerprint
    ):
        raise SiteError(
            "SITE_SOURCE_CONFLICT", "来源内容或配置已变化，请重新预览后发布", 409
        )
    if not before.pages:
        raise SiteError("SITE_EMPTY", "请先选择至少一篇文档再发布", 422)
    await _require_available_slug(site.slug, session, site.id)
    snapshot = await build_snapshot(site, session, url_policy=url_policy)
    after = await resolve_site_source(site, session)
    if before.fingerprint != after.fingerprint:
        raise SiteError(
            "SITE_SOURCE_CONFLICT", "发布期间来源内容已变化，请重新预览后发布", 409
        )
    release_id = new_uuidv7()
    number = site.release_sequence + 1
    timestamp = now_ms()
    snapshot = snapshot.model_copy(
        update={
            "release_id": release_id,
            "release_number": number,
            "published_at_ms": timestamp,
        }
    )
    try:
        # The conditional update serializes publishers and detects configuration edits.
        # The release insert and active pointer become visible in the same transaction.
        result = await session.execute(
            update(Site)
            .where(
                Site.id == site.id,
                Site.config_version == site.config_version,
                Site.release_sequence == site.release_sequence,
            )
            .values(
                published_release_id=release_id,
                published_slug=snapshot.slug,
                release_sequence=number,
                page_registry=after.registry,
                updated_at_ms=timestamp,
            )
            .returning(Site.id)
            .execution_options(synchronize_session=False)
        )
        if result.scalar_one_or_none() is None:
            await session.rollback()
            raise site_version_conflict()
        await reserve_site_slug(site.id, snapshot.slug, session)
        await release_unused_site_slugs(site.id, session)
        session.add(
            SiteRelease(
                id=release_id,
                site_id=site.id,
                release_number=number,
                snapshot=snapshot.model_dump(mode="json"),
                source_manifest=after.manifest,
                published_at_ms=timestamp,
            )
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise site_version_conflict() from None
    logger.info(
        "Site published: site_id=%s release_id=%s release_number=%s actor_id=%s",
        site.id,
        release_id,
        number,
        user.id,
    )
    return snapshot


async def list_releases(
    site_id: UUID, user: User, session: AsyncSession, *, offset: int, limit: int
) -> tuple[list[SiteReleaseOut], int]:
    site, _ = await _site_actor(site_id, user, session)
    predicate = SiteRelease.site_id == site.id
    total = await session.scalar(
        select(func.count()).select_from(SiteRelease).where(predicate)
    )
    releases = await session.execute(
        select(SiteRelease.id, SiteRelease.release_number, SiteRelease.published_at_ms)
        .where(predicate)
        .order_by(SiteRelease.release_number.desc())
        .offset(offset)
        .limit(limit)
    )
    return [
        SiteReleaseOut(
            id=release.id,
            release_number=release.release_number,
            published_at_ms=release.published_at_ms,
            is_active=release.id == site.published_release_id,
        )
        for release in releases
    ], total or 0


async def activate_release(
    site_id: UUID, release_id: UUID, user: User, session: AsyncSession
) -> Site:
    site, member = await _site_actor(site_id, user, session)
    _require_publisher(member)
    release = await session.get(SiteRelease, release_id)
    if release is None or release.site_id != site.id:
        raise SiteError("SITE_RELEASE_NOT_FOUND", "站点发布版本不存在", 404)
    snapshot = SiteSnapshotOut.model_validate(release.snapshot)
    await _require_available_slug(snapshot.slug, session, site.id)
    try:
        await session.execute(
            update(Site)
            .where(Site.id == site.id)
            .values(
                published_release_id=release.id,
                published_slug=snapshot.slug,
                updated_at_ms=now_ms(),
            )
            .execution_options(synchronize_session=False)
        )
        await reserve_site_slug(site.id, snapshot.slug, session)
        await release_unused_site_slugs(site.id, session)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise site_slug_conflict() from None
    await session.refresh(site)
    logger.info(
        "Site release activated: site_id=%s release_id=%s actor_id=%s",
        site.id,
        release.id,
        user.id,
    )
    return site


async def unpublish_site(site_id: UUID, user: User, session: AsyncSession) -> Site:
    site, member = await _site_actor(site_id, user, session)
    _require_publisher(member)
    await session.execute(
        update(Site)
        .where(Site.id == site.id)
        .values(
            published_release_id=None,
            published_slug=None,
            updated_at_ms=now_ms(),
        )
        .execution_options(synchronize_session=False)
    )
    await release_unused_site_slugs(site.id, session)
    await session.commit()
    await session.refresh(site)
    logger.info("Site unpublished: site_id=%s actor_id=%s", site.id, user.id)
    return site


async def read_public_site(slug: str, session: AsyncSession) -> SiteSnapshotOut:
    snapshot = await session.scalar(
        select(SiteRelease.snapshot)
        .join(
            Site,
            (Site.published_release_id == SiteRelease.id)
            & (Site.id == SiteRelease.site_id),
        )
        .where(Site.published_slug == slug)
    )
    if snapshot is None:
        raise SiteError("SITE_NOT_FOUND", "站点不存在或尚未发布", 404)
    return SiteSnapshotOut.model_validate(snapshot)
