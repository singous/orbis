from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_errors import invalid_site_document
from orbis_user_api.application.site_urls import PublicUrlPolicy
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.site import Site
from orbis_user_api.schemas.site import SiteNavigationItem, SitePageOut, SiteSnapshotOut


async def selected_active_note(
    note_id: UUID, workspace_id: UUID, session: AsyncSession
) -> Note:
    note = await session.get(Note, note_id)
    if note is None or note.workspace_id != workspace_id or note.status != "active":
        raise invalid_site_document()
    notebook = await session.get(Notebook, note.notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != workspace_id
        or notebook.status != "active"
    ):
        raise invalid_site_document()
    group = await session.get(NoteGroup, notebook.group_id)
    if group is None or group.workspace_id != workspace_id or group.status != "active":
        raise invalid_site_document()
    seen = {note.id}
    parent_id = note.parent_id
    while parent_id is not None:
        if parent_id in seen:
            raise invalid_site_document()
        seen.add(parent_id)
        parent = await session.get(Note, parent_id)
        if (
            parent is None
            or parent.workspace_id != workspace_id
            or parent.notebook_id != notebook.id
            or parent.status != "active"
        ):
            raise invalid_site_document()
        parent_id = parent.parent_id
    return note


async def validate_navigation(
    navigation: list[SiteNavigationItem], workspace_id: UUID, session: AsyncSession
) -> None:
    for entry in navigation:
        await selected_active_note(entry.note_id, workspace_id, session)


async def build_snapshot(
    site: Site, session: AsyncSession, *, url_policy: PublicUrlPolicy
) -> SiteSnapshotOut:
    pages: list[SitePageOut] = []
    for raw_entry in site.navigation:
        entry = SiteNavigationItem.model_validate(raw_entry)
        await selected_active_note(entry.note_id, site.workspace_id, session)
        content = await session.scalar(
            select(NoteContent).where(NoteContent.note_id == entry.note_id)
        )
        if content is None:
            raise invalid_site_document()
        blocks = public_note_blocks(content.blocks, url_policy=url_policy)
        pages.append(
            SitePageOut(
                slug=entry.slug,
                title=entry.title,
                group=entry.group,
                blocks=blocks,
                plain_text=derive_plain_text(blocks),
            )
        )
    return SiteSnapshotOut(
        name=site.name,
        slug=site.slug,
        description=site.description,
        site_kind=site.site_kind,
        accent_color=site.accent_color,
        pages=pages,
        release_id=None,
        release_number=None,
        published_at_ms=None,
    )
