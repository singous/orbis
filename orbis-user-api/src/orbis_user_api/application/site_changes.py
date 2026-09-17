from __future__ import annotations

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_sources import ResolvedPage, ResolvedSource, digest
from orbis_user_api.models.site import SiteRelease
from orbis_user_api.schemas.site_source import SiteChangePage, SiteChanges


def _legacy_page_changed(
    page: ResolvedPage, previous: dict, position: int, old_position: int
) -> bool:
    metadata = page.metadata.model_dump(mode="json", exclude={"note_id"})
    previous_metadata = SiteChangePage.model_validate(
        {**previous, "note_id": None}
    ).model_dump(mode="json", exclude={"note_id"})
    if previous.get("updated_at_ms") is None:
        metadata.pop("updated_at_ms")
    if position != old_position or any(
        value != previous_metadata.get(key) for key, value in metadata.items()
    ):
        return True
    try:
        return digest(public_note_blocks(page.blocks)) != digest(previous["blocks"])
    except SiteError:
        # Source management must stay usable to exclude or repair invalid content.
        return True


def _legacy_changes(current: ResolvedSource, previous: SiteRelease) -> SiteChanges:
    owners = {
        path: identity
        for identity, record in current.registry.items()
        for path in [record["slug"], *record.get("aliases", [])]
    }
    old_by_id = {}
    removed = []
    for position, page in enumerate(previous.snapshot.get("pages", [])):
        identity = owners.get(page["slug"])
        if identity in current.manifest:
            old_by_id[identity] = (page, position)
        else:
            removed.append(SiteChangePage.model_validate({**page, "note_id": identity}))
    added, modified = [], []
    for position, page in enumerate(current.pages):
        old = old_by_id.get(str(page.metadata.note_id))
        item = SiteChangePage.model_validate(page.metadata.model_dump())
        if old is None:
            added.append(item)
        elif _legacy_page_changed(page, old[0], position, old[1]):
            modified.append(item)
    return SiteChanges(added=added, modified=modified, removed=removed)


def source_changes(
    current: ResolvedSource, previous: SiteRelease | None
) -> SiteChanges:
    before = previous.source_manifest if previous else {}
    after = current.manifest
    if previous and not before:
        return _legacy_changes(current, previous)
    return SiteChanges(
        added=[
            SiteChangePage.model_validate(value)
            for key, value in after.items()
            if key not in before
        ],
        modified=[
            SiteChangePage.model_validate(value)
            for key, value in after.items()
            if key in before and value != before[key]
        ],
        removed=[
            SiteChangePage.model_validate(value)
            for key, value in before.items()
            if key not in after
        ],
    )
