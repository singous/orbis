from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_sources import (
    resolve_site_source,
)
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.models.site import Site
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut
from orbis_user_api.schemas.site_source import SiteBranding


async def build_snapshot(
    site: Site, session: AsyncSession, *, url_policy: PublicUrlPolicy
) -> SiteSnapshotOut:
    resolved = await resolve_site_source(site, session)
    pages: list[SitePageOut] = []
    for page in resolved.pages:
        blocks = public_note_blocks(page.blocks, url_policy=url_policy)
        pages.append(
            SitePageOut(
                **page.metadata.model_dump(exclude={"note_id"}),
                blocks=blocks,
                plain_text=derive_plain_text(blocks),
            )
        )
    branding = SiteBranding.model_validate(site.branding or {})
    if branding.logo_url:
        url_policy.validate(branding.logo_url, media=True)
    for link in [
        *branding.links,
        *branding.footer_links,
        *([branding.cta] if branding.cta else []),
    ]:
        url_policy.validate(link.url)
    return SiteSnapshotOut(
        name=site.name,
        slug=site.slug,
        description=site.description,
        site_kind=site.site_kind,
        accent_color=site.accent_color,
        pages=pages,
        branding=branding,
        redirects=resolved.redirects,
        release_id=None,
        release_number=None,
        published_at_ms=None,
    )
