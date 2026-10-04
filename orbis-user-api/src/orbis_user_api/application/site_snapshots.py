from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_page_repository import SitePageRepository
from orbis_user_api.application.site_references import (
    current_reference_rewrites,
    validate_site_reference,
)
from orbis_user_api.application.site_sources import (
    digest,
    resolve_site_source,
)
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.domain.document_references import iter_document_references
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.models.site import Site
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut
from orbis_user_api.schemas.site_source import SiteBranding

# Bump when the public content projection or validation contract changes.
PAGE_PROJECTION_REVISION = 1


def page_render_fingerprint(page, url_policy: PublicUrlPolicy) -> str:
    rewrites = current_reference_rewrites()
    references = sorted(
        (value, media, rewrites.get((value, media), value))
        for value, media in iter_document_references(page.blocks)
    )
    return digest(
        {
            "projection_revision": PAGE_PROJECTION_REVISION,
            "content": digest(page.blocks),
            "references": references,
            "url_policy": {
                "locations": sorted(url_policy.internal_locations),
                "unsupported": url_policy.has_unsupported_location,
            },
        }
    )


async def build_snapshot(
    site: Site, session: AsyncSession, *, url_policy: PublicUrlPolicy
) -> SiteSnapshotOut:
    resolved = await resolve_site_source(site, session)
    pages: list[SitePageOut] = []
    repository = SitePageRepository(session)
    for page in resolved.pages:
        fingerprint = page_render_fingerprint(page, url_policy)
        reused = await repository.reusable_body(site.id, fingerprint)
        blocks = (
            reused.blocks
            if reused
            else public_note_blocks(page.blocks, url_policy=url_policy)
        )
        pages.append(
            SitePageOut(
                **page.metadata.model_dump(exclude={"note_id"}),
                blocks=blocks,
                plain_text=reused.plain_text if reused else derive_plain_text(blocks),
            )
        )
    branding = SiteBranding.model_validate(site.branding or {})
    if branding.logo_url:
        branding.logo_url = validate_site_reference(
            branding.logo_url, url_policy, media=True
        )
    for link in [
        *branding.links,
        *branding.footer_links,
        *([branding.cta] if branding.cta else []),
    ]:
        link.url = validate_site_reference(link.url, url_policy)
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
