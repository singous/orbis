"""One immutable release reader for indexed pages and read-only legacy JSON."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_page_cache import MAX_PAGE_CACHE_BYTES, page_cache
from orbis_user_api.application.site_sources import digest
from orbis_user_api.db.types import GUID
from orbis_user_api.models.site import Site, SiteRelease
from orbis_user_api.models.site_page import SitePageBody, SiteReleasePage
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut
from orbis_user_api.schemas.site_delivery import SiteSearchOut

INDEXED_PAGE_FORMAT = "indexed-pages-1"
PAGE_METADATA_FIELDS = (
    "slug",
    "title",
    "group",
    "parent_slug",
    "section",
    "description",
    "updated_at_ms",
)
HEADER_FIELDS = (
    "name",
    "slug",
    "description",
    "site_kind",
    "accent_color",
    "branding",
    "redirects",
    "release_id",
    "release_number",
    "published_at_ms",
)


@dataclass(frozen=True)
class ActiveRelease:
    site_id: UUID
    release_id: UUID
    release_number: int
    published_at_ms: int
    indexed: bool


def missing_site() -> SiteError:
    return SiteError("SITE_NOT_FOUND", "站点不存在或尚未发布", 404)


def missing_page() -> SiteError:
    return SiteError("SITE_PAGE_NOT_FOUND", "公开页面不存在或尚未发布", 404)


class SitePageRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def active(
        self, slug: str, expected_release_id: UUID | None = None
    ) -> ActiveRelease:
        row = (
            await self.session.execute(
                select(
                    Site.id,
                    SiteRelease.id,
                    SiteRelease.release_number,
                    SiteRelease.published_at_ms,
                    SiteRelease.snapshot["storage_format"].as_string(),
                )
                .join(
                    SiteRelease,
                    (Site.published_release_id == SiteRelease.id)
                    & (Site.id == SiteRelease.site_id),
                )
                .where(Site.published_slug == slug)
            )
        ).one_or_none()
        if row is None:
            raise missing_site()
        if expected_release_id is not None and row[1] != expected_release_id:
            raise SiteError(
                "SITE_RELEASE_CHANGED", "站点发布版本已更新，请刷新页面后重试", 409
            )
        return ActiveRelease(
            row[0], row[1], row[2], row[3], row[4] == INDEXED_PAGE_FORMAT
        )

    async def header(self, release: ActiveRelease) -> dict[str, Any]:
        columns = [SiteRelease.snapshot[field].label(field) for field in HEADER_FIELDS]
        row = (
            (
                await self.session.execute(
                    select(*columns).where(
                        SiteRelease.id == release.release_id,
                        SiteRelease.site_id == release.site_id,
                    )
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise missing_site()
        value = dict(row)
        value.update(
            release_id=str(release.release_id),
            release_number=release.release_number,
            published_at_ms=release.published_at_ms,
        )
        value["branding"] = value.get("branding") or {}
        value["redirects"] = value.get("redirects") or {}
        return value

    async def _legacy_rows(
        self,
        release: ActiveRelease,
        *,
        page_slug: str | None = None,
        metadata_only: bool = False,
        search: bool = False,
    ) -> list[dict[str, Any]]:
        postgres = self.session.get_bind().dialect.name == "postgresql"
        if postgres:
            value, iterator, ordinal = (
                "item.value",
                "jsonb_array_elements(snapshot->'pages') WITH ORDINALITY AS item(value,ordinal)",
                "item.ordinal",
            )
            extract = lambda key: f"{value}->'{key}'"
            fields = f"jsonb_build_object({','.join(repr(key) + ',' + extract(key) for key in PAGE_METADATA_FIELDS)})"
            condition = "item.value->>'slug' = :page_slug"
        else:
            value, iterator, ordinal = (
                "item.value",
                "json_each(snapshot, '$.pages') AS item",
                "CAST(item.key AS INTEGER)",
            )
            extract = lambda key: f"json_extract({value}, '$.{key}')"
            fields = f"json_object({','.join(repr(key) + ',' + extract(key) for key in PAGE_METADATA_FIELDS)})"
            condition = "json_extract(item.value, '$.slug') = :page_slug"
        if search:
            fields = fields[:-1] + ",'plain_text'," + extract("plain_text") + ")"
        elif not metadata_only:
            fields = value
        sql = f"SELECT {fields} AS page FROM site_releases, {iterator} WHERE site_releases.id=:release_id"
        params = {"release_id": release.release_id}
        if page_slug is not None:
            sql += f" AND {condition}"
            params["page_slug"] = page_slug
        sql += f" ORDER BY {ordinal}"
        if not metadata_only and not search:
            sql += " LIMIT 1"
        statement = text(sql).bindparams(bindparam("release_id", type_=GUID()))
        import json

        return [
            json.loads(row[0]) if isinstance(row[0], str) else row[0]
            for row in await self.session.execute(statement, params)
        ]

    async def metadata_snapshot(self, release: ActiveRelease) -> SiteSnapshotOut:
        header = await self.header(release)
        if release.indexed:
            pages = list(
                await self.session.scalars(
                    select(SiteReleasePage.metadata_fields)
                    .where(
                        SiteReleasePage.release_id == release.release_id,
                        SiteReleasePage.site_id == release.site_id,
                    )
                    .order_by(SiteReleasePage.position)
                )
            )
        else:
            pages = await self._legacy_rows(release, metadata_only=True)
        return SiteSnapshotOut.model_validate(
            {
                **header,
                "pages": [
                    {
                        **page,
                        "description": page.get("description") or "",
                        "blocks": {
                            "schema_version": 2,
                            "editor": "blocknote",
                            "blocks": [],
                        },
                        "plain_text": "",
                    }
                    for page in pages
                ],
            }
        )

    async def page(self, release: ActiveRelease, page_slug: str | None) -> SitePageOut:
        if page_slug is None:
            if release.indexed:
                page_slug = await self.session.scalar(
                    select(SiteReleasePage.slug)
                    .where(SiteReleasePage.release_id == release.release_id)
                    .order_by(SiteReleasePage.position)
                    .limit(1)
                )
            else:
                rows = await self._legacy_rows(release)
                if not rows:
                    raise missing_page()
                return SitePageOut.model_validate(rows[0])
        key = (self.session.get_bind(), release.release_id, page_slug)
        cached = page_cache.get(key)
        if cached is not None:
            return SitePageOut.model_validate(cached)
        if release.indexed:
            row = (
                await self.session.execute(
                    select(
                        SiteReleasePage.metadata_fields,
                        SitePageBody.blocks,
                        SitePageBody.plain_text,
                        SitePageBody.body_bytes,
                    )
                    .join(
                        SitePageBody,
                        (SitePageBody.id == SiteReleasePage.body_id)
                        & (SitePageBody.site_id == SiteReleasePage.site_id),
                    )
                    .where(
                        SiteReleasePage.release_id == release.release_id,
                        SiteReleasePage.site_id == release.site_id,
                        SiteReleasePage.slug == page_slug,
                    )
                )
            ).one_or_none()
            if row is None:
                raise missing_page()
            page = SitePageOut.model_validate(
                {**row[0], "blocks": row[1], "plain_text": row[2]}
            )
        else:
            rows = await self._legacy_rows(release, page_slug=page_slug)
            if not rows:
                raise missing_page()
            page = SitePageOut.model_validate(rows[0])
        if not release.indexed or row[3] <= MAX_PAGE_CACHE_BYTES:
            page_cache.put(key, page.model_dump(mode="json"))
        return page

    async def snapshot(self, release: ActiveRelease) -> SiteSnapshotOut:
        if not release.indexed:
            snapshot = await self.session.scalar(
                select(SiteRelease.snapshot).where(
                    SiteRelease.id == release.release_id,
                    SiteRelease.site_id == release.site_id,
                )
            )
            return SiteSnapshotOut.model_validate(snapshot)
        header = await self.header(release)
        rows = (
            await self.session.execute(
                select(
                    SiteReleasePage.metadata_fields,
                    SitePageBody.blocks,
                    SitePageBody.plain_text,
                )
                .join(SitePageBody, SitePageBody.id == SiteReleasePage.body_id)
                .where(
                    SiteReleasePage.release_id == release.release_id,
                    SiteReleasePage.site_id == release.site_id,
                    SitePageBody.site_id == release.site_id,
                )
                .order_by(SiteReleasePage.position)
            )
        ).all()
        return SiteSnapshotOut.model_validate(
            {
                **header,
                "pages": [
                    {**row[0], "blocks": row[1], "plain_text": row[2]} for row in rows
                ],
            }
        )

    async def search(self, release: ActiveRelease) -> SiteSearchOut:
        if not release.indexed:
            pages = await self._legacy_rows(release, metadata_only=True, search=True)
        else:
            rows = (
                await self.session.execute(
                    select(SiteReleasePage.metadata_fields, SitePageBody.plain_text)
                    .join(SitePageBody, SitePageBody.id == SiteReleasePage.body_id)
                    .where(
                        SiteReleasePage.release_id == release.release_id,
                        SiteReleasePage.site_id == release.site_id,
                        SitePageBody.site_id == release.site_id,
                    )
                    .order_by(SiteReleasePage.position)
                )
            ).all()
            pages = [{**row[0], "plain_text": row[1]} for row in rows]
        return SiteSearchOut.model_validate(
            {
                "release_id": release.release_id,
                "pages": [
                    {
                        **page,
                        "description": page.get("description") or "",
                        "plain_text": page.get("plain_text") or "",
                    }
                    for page in pages
                ],
            }
        )

    async def reusable_body(
        self, site_id: UUID, render_fingerprint: str
    ) -> SitePageBody | None:
        return await self.session.scalar(
            select(SitePageBody)
            .join(SiteReleasePage, SiteReleasePage.body_id == SitePageBody.id)
            .where(
                SiteReleasePage.site_id == site_id,
                SitePageBody.site_id == site_id,
                SiteReleasePage.render_fingerprint == render_fingerprint,
            )
            .limit(1)
        )

    async def persist(
        self,
        site_id: UUID,
        snapshot: SiteSnapshotOut,
        render_fingerprints: dict[str, str],
    ) -> dict[str, Any]:
        header = snapshot.model_dump(mode="json", exclude={"pages"})
        header["storage_format"] = INDEXED_PAGE_FORMAT
        header["pages"] = []
        for position, page in enumerate(snapshot.pages):
            metadata = page.model_dump(mode="json", exclude={"blocks", "plain_text"})
            header["pages"].append(metadata)
            from orbis_user_api.application.published_tables import digest_content, persist_tables
            body_digest = digest({"blocks": digest_content(page.blocks), "plain_text": page.plain_text})
            body = await self.session.scalar(
                select(SitePageBody).where(
                    SitePageBody.site_id == site_id,
                    SitePageBody.content_digest == body_digest,
                )
            )
            if body is None:
                body_id = new_uuidv7()
                blocks = await persist_tables(self.session, site_id, body_id, page.blocks)
                body = SitePageBody(
                    id=body_id,
                    site_id=site_id,
                    content_digest=body_digest,
                    blocks=blocks,
                    plain_text=page.plain_text,
                    body_bytes=len(
                        json.dumps(
                            {"blocks": blocks, "plain_text": page.plain_text},
                            ensure_ascii=False,
                        ).encode()
                    ),
                )
                self.session.add(body)
                await self.session.flush()
            self.session.add(
                SiteReleasePage(
                    site_id=site_id,
                    release_id=snapshot.release_id,
                    slug=page.slug,
                    position=position,
                    body_id=body.id,
                    metadata_fields=metadata,
                    render_fingerprint=render_fingerprints[page.slug],
                )
            )
        return header
