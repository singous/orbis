from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_errors import site_slug_conflict
from orbis_user_api.models.site import Site, SiteSlugReservation


async def reserve_site_slug(site_id: UUID, slug: str, session: AsyncSession) -> None:
    """Keep draft and public path claims in one atomic, unique namespace."""
    with session.no_autoflush:
        reservation = await session.scalar(
            select(SiteSlugReservation)
            .where(SiteSlugReservation.slug == slug)
            .with_for_update()
        )
    if reservation is not None:
        if reservation.site_id != site_id:
            await session.rollback()
            raise site_slug_conflict()
        return
    session.add(SiteSlugReservation(site_id=site_id, slug=slug))
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise site_slug_conflict() from None


async def release_unused_site_slugs(site_id: UUID, session: AsyncSession) -> None:
    """Run after updating the site row, while its write lock is still held."""
    current = (
        await session.execute(
            select(Site.slug, Site.published_slug).where(Site.id == site_id)
        )
    ).one()
    retained = {slug for slug in current if slug is not None}
    await session.execute(
        delete(SiteSlugReservation).where(
            SiteSlugReservation.site_id == site_id,
            SiteSlugReservation.slug.not_in(retained),
        )
    )
