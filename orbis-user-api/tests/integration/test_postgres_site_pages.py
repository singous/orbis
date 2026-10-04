"""Real PostgreSQL publication lifecycle and indexed single-page scale evidence."""

from __future__ import annotations

import json
from time import perf_counter
from uuid import UUID

from sqlalchemy import event, func, select, text, update
from test_postgres_base_mvp import postgres_client as postgres_fixture
from test_postgres_base_mvp import request_data, setup_document

from orbis_user_api.application.site_page_cache import page_cache
from orbis_user_api.application.site_page_repository import SitePageRepository
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.site import Site, SiteRelease
from orbis_user_api.models.site_page import SitePageBody, SiteReleasePage
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut

postgres_client = postgres_fixture


def block(identifier, value):
    return {
        "id": identifier,
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": value}],
        "children": [],
    }


def create_site(client, headers, note, slug="pg-indexed"):
    return request_data(
        client,
        "POST",
        "/sites",
        201,
        headers=headers,
        json={
            "name": "PostgreSQL indexed site",
            "slug": slug,
            "navigation": [
                {
                    "note_id": note["id"],
                    "slug": "first",
                    "title": "First",
                    "group": None,
                }
            ],
        },
    )


def test_postgres_real_publication_reuse_legacy_fallback_and_rollback(postgres_client):
    client = postgres_client
    headers, note = setup_document(client)
    request_data(
        client,
        "PUT",
        f"/notes/{note['id']}/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [block("first", "Version one")],
            },
        },
    )
    site = create_site(client, headers, note)
    first = request_data(
        client, "POST", f"/sites/{site['id']}/publish", headers=headers
    )
    second = request_data(
        client, "POST", f"/sites/{site['id']}/publish", headers=headers
    )

    async def counts():
        async with client.app.state.session_factory() as session:
            return await session.scalar(
                select(func.count(SitePageBody.id))
            ), await session.scalar(select(func.count(SiteReleasePage.id)))

    assert client.portal.call(counts) == (1, 2)
    assert (
        request_data(client, "GET", "/public/sites/pg-indexed/pages/first")["page"][
            "plain_text"
        ]
        == "Version one"
    )

    async def historical_json():
        async with client.app.state.session_factory() as session:
            await session.execute(
                update(SiteRelease)
                .where(SiteRelease.id == UUID(first["release_id"]))
                .values(snapshot=first)
            )
            await session.commit()

    client.portal.call(historical_json)
    request_data(
        client,
        "POST",
        f"/sites/{site['id']}/releases/{first['release_id']}/activate",
        headers=headers,
    )
    page_cache.clear()
    assert (
        request_data(client, "GET", "/public/sites/pg-indexed/pages/first")[
            "release_id"
        ]
        == first["release_id"]
    )
    assert (
        len(request_data(client, "GET", "/public/sites/pg-indexed/manifest")["pages"])
        == 1
    )
    assert (
        request_data(client, "GET", "/public/sites/pg-indexed/search")["pages"][0][
            "plain_text"
        ]
        == "Version one"
    )
    assert request_data(client, "GET", "/public/sites/pg-indexed") == first
    request_data(
        client,
        "POST",
        f"/sites/{site['id']}/releases/{second['release_id']}/activate",
        headers=headers,
    )
    request_data(client, "POST", f"/sites/{site['id']}/unpublish", headers=headers)
    assert client.get("/public/sites/pg-indexed/pages/first").status_code == 404


def test_postgres_200_page_snapshot_queries_one_body_with_index_and_bounded_cache(
    postgres_client,
):
    client = postgres_client
    headers, note = setup_document(client)
    site = create_site(client, headers, note, "pg-scale")
    site_id, release_id = UUID(site["id"]), new_uuidv7()
    page_count, body_chars = 200, 128 * 1024
    snapshot = SiteSnapshotOut(
        name="200-page SQL evidence",
        slug="pg-scale",
        description="",
        site_kind="knowledge",
        accent_color="#0f766e",
        branding={},
        redirects={},
        release_id=release_id,
        release_number=1,
        published_at_ms=now_ms(),
        pages=[
            SitePageOut(
                slug=f"page-{index}",
                title=f"Page {index}",
                group=None,
                blocks={
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": [block("public-0", f"Page {index} " + "x" * body_chars)],
                },
                plain_text=f"Page {index} " + "x" * body_chars,
            )
            for index in range(page_count)
        ],
    )

    async def persist_fixture():
        async with client.app.state.session_factory() as session:
            metadata = await SitePageRepository(session).persist(
                site_id,
                snapshot,
                {
                    page.slug: f"{index:064x}"
                    for index, page in enumerate(snapshot.pages)
                },
            )
            session.add(
                SiteRelease(
                    id=release_id,
                    site_id=site_id,
                    release_number=1,
                    snapshot=metadata,
                    source_manifest={},
                    asset_manifest={},
                    published_at_ms=snapshot.published_at_ms,
                )
            )
            await session.execute(
                update(Site)
                .where(Site.id == site_id)
                .values(
                    published_release_id=release_id,
                    published_slug="pg-scale",
                    release_sequence=1,
                )
            )
            await session.commit()
            await session.execute(text("ANALYZE site_release_pages"))
            await session.execute(text("ANALYZE site_page_bodies"))
            plan = (
                await session.execute(
                    text(
                        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT b.blocks FROM site_release_pages p JOIN site_page_bodies b ON b.id=p.body_id WHERE p.release_id=:release AND p.slug='page-99'"
                    ).bindparams(release=release_id)
                )
            ).scalar_one()
            metadata_bytes = len(json.dumps(metadata).encode())
            return plan, metadata_bytes

    plan, metadata_bytes = client.portal.call(persist_fixture)
    plan_text = json.dumps(plan)
    assert (
        "uq_site_release_page_slug" in plan_text
        and "site_page_bodies_pkey" in plan_text
    ), plan_text
    assert metadata_bytes < 64 * 1024
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    page_cache.clear()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        started = perf_counter()
        page = request_data(client, "GET", "/public/sites/pg-scale/pages/page-99")
        cold_ms = (perf_counter() - started) * 1000
        assert page["page"]["plain_text"].startswith("Page 99 ")
        assert (
            len([query for query in statements if "site_page_bodies.blocks" in query])
            == 1
        )
        assert all(
            not query.startswith("select site_releases.snapshot\n")
            for query in statements
        )
        statements.clear()
        started = perf_counter()
        request_data(client, "GET", "/public/sites/pg-scale/pages/page-99")
        cached_ms = (perf_counter() - started) * 1000
        assert any("published_release_id" in query for query in statements)
        assert all("site_page_bodies" not in query for query in statements)
        assert page_cache.byte_size < 512 * 1024
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    print(
        {
            "page_count": page_count,
            "total_plain_chars": page_count * body_chars,
            "release_metadata_bytes": metadata_bytes,
            "target_body_chars": body_chars,
            "cold_ms": round(cold_ms, 2),
            "cached_ms": round(cached_ms, 2),
            "cache_bytes": page_cache.byte_size,
            "index_plan": ["uq_site_release_page_slug", "site_page_bodies_pkey"],
        }
    )
