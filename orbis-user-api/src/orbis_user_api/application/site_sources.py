from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_errors import SiteError, invalid_site_document
from orbis_user_api.application.site_navigation import PagePaths
from orbis_user_api.domain.site import MAX_NAVIGATION_PAGES
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.site import Site
from orbis_user_api.schemas.site import SiteNavigationItem
from orbis_user_api.schemas.site_source import SiteSource, SiteSourcePage


def source_invalid() -> SiteError:
    return SiteError(
        "SITE_SOURCE_INVALID", "来源笔记本或根文档不可用，请检查空间归属与归档状态", 422
    )


def digest(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode()).hexdigest()


@dataclass(frozen=True)
class ResolvedPage:
    metadata: SiteSourcePage
    blocks: dict[str, Any]
    content_version: int


@dataclass(frozen=True)
class ResolvedSource:
    pages: list[ResolvedPage]
    excluded_count: int
    registry: dict[str, Any]
    manifest: dict[str, Any]
    fingerprint: str
    redirects: dict[str, str]


async def selected_active_note(
    note_id: UUID, workspace_id: UUID, session: AsyncSession
) -> Note:
    note = await session.get(Note, note_id, populate_existing=True)
    if note is None or note.workspace_id != workspace_id or note.status != "active":
        raise invalid_site_document()
    notebook = await session.get(Notebook, note.notebook_id, populate_existing=True)
    if (
        notebook is None
        or notebook.workspace_id != workspace_id
        or notebook.status != "active"
    ):
        raise invalid_site_document()
    group = await session.get(NoteGroup, notebook.group_id, populate_existing=True)
    if group is None or group.workspace_id != workspace_id or group.status != "active":
        raise invalid_site_document()
    seen, parent_id = {note.id}, note.parent_id
    while parent_id is not None:
        if parent_id in seen:
            raise invalid_site_document()
        seen.add(parent_id)
        parent = await session.get(Note, parent_id, populate_existing=True)
        if (
            parent is None
            or parent.workspace_id != workspace_id
            or parent.notebook_id != notebook.id
            or parent.status != "active"
        ):
            raise invalid_site_document()
        parent_id = parent.parent_id
    return note


def _ancestors(note: Note, notes: dict[UUID, Note]) -> list[UUID] | None:
    chain, seen = [], {note.id}
    parent_id = note.parent_id
    while parent_id is not None:
        if parent_id in seen:
            raise source_invalid()
        seen.add(parent_id)
        parent = notes.get(parent_id)
        if parent is None or parent.notebook_id != note.notebook_id:
            raise source_invalid()
        if parent.status != "active":
            return None
        chain.append(parent_id)
        parent_id = parent.parent_id
    return chain


async def _notebook_selection(source: SiteSource, site: Site, session: AsyncSession):
    notebook_ids = {binding.notebook_id for binding in source.notebooks}
    rows = await session.execute(
        select(Notebook, NoteGroup)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(
            Notebook.id.in_(notebook_ids), Notebook.workspace_id == site.workspace_id
        )
        .execution_options(populate_existing=True)
    )
    notebooks = {}
    for notebook, group in rows:
        if (
            notebook.status != "active"
            or group.status != "active"
            or group.workspace_id != site.workspace_id
        ):
            raise source_invalid()
        notebooks[notebook.id] = notebook
    if set(notebooks) != notebook_ids:
        raise source_invalid()
    values = await session.scalars(
        select(Note)
        .where(
            Note.notebook_id.in_(notebook_ids), Note.workspace_id == site.workspace_id
        )
        .order_by(Note.sort_order, Note.created_at_ms, Note.id)
        .execution_options(populate_existing=True)
    )
    notes = {note.id: note for note in values}
    active = {}
    for note in notes.values():
        if note.status == "active":
            ancestors = _ancestors(note, notes)
            if ancestors is not None:
                active[note.id] = ancestors
    children: dict[UUID | None, list[Note]] = defaultdict(list)
    for note in notes.values():
        if note.id in active:
            children[note.parent_id].append(note)
    selected, seen, excluded = [], set(), set()
    exclusions = set(source.excluded_note_ids)
    labels: dict[tuple[UUID, str], str] = {}
    used_labels: set[str] = set()
    for binding in source.notebooks:
        label = binding.label or notebooks[binding.notebook_id].title
        label_key = (binding.notebook_id, label)
        if label_key not in labels:
            candidate, suffix = label, 1
            while candidate in used_labels:
                suffix += 1
                candidate = f"{label} ({suffix})"
            labels[label_key] = candidate
            used_labels.add(candidate)
        if binding.root_note_id is not None:
            root = notes.get(binding.root_note_id)
            if (
                root is None
                or root.notebook_id != binding.notebook_id
                or root.id not in active
            ):
                raise source_invalid()
            roots = [root]
        else:
            roots = [
                note
                for note in children[None]
                if note.notebook_id == binding.notebook_id
            ]
        stack = list(reversed(roots))
        while stack:
            note = stack.pop()
            stack.extend(reversed(children[note.id]))
            if exclusions.intersection([note.id, *active[note.id]]):
                excluded.add(note.id)
                continue
            if note.id in seen:
                continue
            seen.add(note.id)
            selected.append((note, labels[label_key], None))
            if len(selected) > MAX_NAVIGATION_PAGES:
                raise SiteError(
                    "SITE_TOO_MANY_PAGES",
                    f"解析后的文档超过 {MAX_NAVIGATION_PAGES} 篇，请缩小来源范围或排除子树",
                    422,
                )
    return selected, len(excluded)


async def resolve_site_source(site: Site, session: AsyncSession) -> ResolvedSource:
    source = SiteSource.model_validate(site.source or {})
    selected, excluded_count = [], 0
    if source.kind == "manual":
        for raw in site.navigation:
            entry = SiteNavigationItem.model_validate(raw)
            note = await selected_active_note(entry.note_id, site.workspace_id, session)
            selected.append((note, None, entry))
    else:
        selected, excluded_count = await _notebook_selection(source, site, session)
    content_rows = await session.scalars(
        select(NoteContent)
        .where(NoteContent.note_id.in_([note.id for note, _, _ in selected]))
        .execution_options(populate_existing=True)
    )
    contents = {content.note_id: content for content in content_rows}
    overrides = {item.note_id: item for item in source.page_overrides}
    paths = PagePaths(site.page_registry or {})
    for note, _, manual in selected:
        override = overrides.get(note.id) if manual is None else None
        explicit = manual.slug if manual else override.slug if override else None
        if explicit:
            paths.reserve(explicit, str(note.id))
    pages, manifest, parents = [], {}, {}
    for note, section, manual in selected:
        content = contents.get(note.id)
        if content is None:
            raise invalid_site_document()
        override = overrides.get(note.id) if manual is None else None
        title = (
            manual.title
            if manual
            else (override.title if override and override.title else note.title)
        )
        explicit = manual.slug if manual else (override.slug if override else None)
        slug = paths.assign(str(note.id), title, explicit)
        metadata = SiteSourcePage(
            note_id=note.id,
            slug=slug,
            title=title,
            group=manual.group if manual else section,
            section=section,
            description=override.description or "" if override else "",
            updated_at_ms=max(note.updated_at_ms, content.updated_at_ms),
        )
        pages.append(
            ResolvedPage(metadata, deepcopy(content.blocks), content.content_version)
        )
        parents[note.id] = note.parent_id if manual is None else None
    by_id = {page.metadata.note_id: page for page in pages}
    for position, page in enumerate(pages):
        parent = by_id.get(parents[page.metadata.note_id])
        if parent and parent.metadata.section == page.metadata.section:
            page.metadata.parent_slug = parent.metadata.slug
        manifest[str(page.metadata.note_id)] = {
            **page.metadata.model_dump(mode="json"),
            "position": position,
            "content_version": page.content_version,
            "content_digest": digest(page.blocks),
        }
    fingerprint = digest(
        {
            "name": site.name,
            "slug": site.slug,
            "description": site.description,
            "site_kind": site.site_kind,
            "accent_color": site.accent_color,
            "config_version": site.config_version or 1,
            "source": source.model_dump(mode="json"),
            "branding": site.branding or {},
            "manifest": manifest,
        }
    )
    return ResolvedSource(
        pages,
        excluded_count,
        paths.registry,
        manifest,
        fingerprint,
        paths.redirects(set(manifest)),
    )
