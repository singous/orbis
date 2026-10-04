"""Indexed publication, dependency reuse, and active-gated immutable caching."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import event, func, select, update

from orbis_user_api.application import site_snapshots
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_page_cache import ImmutablePageCache, page_cache
from orbis_user_api.application.site_page_repository import (
    INDEXED_PAGE_FORMAT,
    SitePageRepository,
)
from orbis_user_api.models.site import SiteRelease
from orbis_user_api.models.site_page import SitePageBody, SiteReleasePage


def paragraph(text, identifier="p"):
    return {
        "id": identifier,
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": text}],
        "children": [],
    }


def note(client, owner, document, title):
    response = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": document["notebook_id"], "title": title},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def save(client, owner, document, blocks):
    current = client.get(f"/notes/{document['id']}/content", headers=owner).json()[
        "data"
    ]
    result = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={
            "expected_version": current["content_version"],
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": blocks},
        },
    )
    assert result.status_code == 200, result.text


def create_site(client, owner, *documents, slug="indexed"):
    config = {
        "name": "Indexed publication",
        "slug": slug,
        "navigation": [
            {
                "note_id": document["id"],
                "slug": f"page-{index}",
                "title": document["title"],
                "group": None,
            }
            for index, document in enumerate(documents)
        ],
    }
    response = client.post("/sites", headers=owner, json=config)
    assert response.status_code == 201, response.text
    return response.json()["data"], config


def publish(client, owner, site):
    result = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert result.status_code == 200, result.text
    return result.json()["data"]


def release_bindings(client, release_id):
    async def read():
        async with client.app.state.session_factory() as session:
            rows = await session.execute(
                select(SiteReleasePage.slug, SiteReleasePage.body_id).where(
                    SiteReleasePage.release_id == UUID(release_id)
                )
            )
            return dict(rows.all()), await session.scalar(
                select(func.count(SitePageBody.id))
            )

    return client.portal.call(read)


def test_new_release_is_body_free_and_public_delivery_queries_only_target_page(
    client, owner, document
):
    second = note(client, owner, document, "Second")
    save(client, owner, document, [paragraph("FIRST_BODY_ONLY")])
    save(client, owner, second, [paragraph("SECOND_BODY_ONLY")])
    site, _ = create_site(client, owner, document, second)
    release = publish(client, owner, site)

    async def stored():
        async with client.app.state.session_factory() as session:
            return (
                await session.get(SiteRelease, UUID(release["release_id"]))
            ).snapshot

    persisted = client.portal.call(stored)
    assert persisted["storage_format"] == INDEXED_PAGE_FORMAT
    assert all(
        "blocks" not in page and "plain_text" not in page for page in persisted["pages"]
    )
    assert "FIRST_BODY_ONLY" not in str(persisted) and "SECOND_BODY_ONLY" not in str(
        persisted
    )
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    page_cache.clear()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/public/sites/indexed/pages/page-0")
        assert response.status_code == 200, response.text
        assert (
            "FIRST_BODY_ONLY" in response.text
            and "SECOND_BODY_ONLY" not in response.text
        )
        assert len([sql for sql in statements if "site_page_bodies.blocks" in sql]) == 1
        assert all(
            not sql.startswith("select site_releases.snapshot\n") for sql in statements
        )
        assert any("site_release_pages.slug =" in sql for sql in statements)
        statements.clear()
        assert client.get("/public/sites/indexed/pages/page-0").status_code == 200
        assert any("published_release_id" in sql for sql in statements)
        assert all("site_page_bodies" not in sql for sql in statements)
        statements.clear()
        manifest = client.get("/public/sites/indexed/manifest")
        assert manifest.status_code == 200 and "FIRST_BODY_ONLY" not in manifest.text
        assert all("site_page_bodies" not in sql for sql in statements)
        statements.clear()
        search = client.get("/public/sites/indexed/search")
        assert (
            search.status_code == 200
            and "FIRST_BODY_ONLY" in search.text
            and "SECOND_BODY_ONLY" in search.text
        )
        assert all("site_page_bodies.blocks" not in sql for sql in statements)
        statements.clear()
        html = client.get("/s/indexed/page-0")
        assert (
            html.status_code == 200
            and "FIRST_BODY_ONLY" in html.text
            and "SECOND_BODY_ONLY" not in html.text
        )
        assert all(
            not sql.startswith("select site_releases.snapshot\n") for sql in statements
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert client.get("/public/sites/indexed").json()["data"] == release


def test_publication_reuses_unchanged_bodies_and_rebuilds_changed_reference_dependencies(
    client, owner, document, monkeypatch
):
    second = note(client, owner, document, "Second")
    link = {
        "id": "link",
        "type": "paragraph",
        "props": {},
        "content": [
            {
                "type": "link",
                "href": f"orbis-note:{second['id']}",
                "content": [{"type": "text", "text": "Read second"}],
            }
        ],
        "children": [],
    }
    save(client, owner, document, [link])
    save(client, owner, second, [paragraph("Second current text")])
    site, config = create_site(client, owner, document, second)
    first = publish(client, owner, site)
    first_bindings, first_count = release_bindings(client, first["release_id"])
    calls = []
    original = site_snapshots.public_note_blocks

    def rendered(blocks, **kwargs):
        calls.append(blocks)
        return original(blocks, **kwargs)

    monkeypatch.setattr(site_snapshots, "public_note_blocks", rendered)
    repeated = publish(client, owner, site)
    repeated_bindings, repeated_count = release_bindings(client, repeated["release_id"])
    assert calls == []
    assert repeated_bindings == first_bindings and repeated_count == first_count == 2
    config["navigation"][1]["slug"] = "renamed"
    updated = client.put(
        f"/sites/{site['id']}", headers=owner, json={**config, "expected_version": 1}
    )
    assert updated.status_code == 200, updated.text
    renamed = publish(client, owner, site)
    renamed_bindings, renamed_count = release_bindings(client, renamed["release_id"])
    assert len(calls) == 1
    assert renamed_bindings["renamed"] == first_bindings["page-1"]
    assert renamed_bindings["page-0"] != first_bindings["page-0"] and renamed_count == 3
    assert "/s/indexed/renamed" in client.get("/public/sites/indexed/pages/page-0").text


def test_live_edits_do_not_publish_and_cache_cannot_bypass_revoke_or_rollback(
    client, owner, document
):
    save(client, owner, document, [paragraph("First release")])
    site, _ = create_site(client, owner, document)
    first = publish(client, owner, site)
    assert "First release" in client.get("/public/sites/indexed/pages/page-0").text
    save(client, owner, document, [paragraph("Private edited text")])
    assert (
        "Private edited text"
        not in client.get("/public/sites/indexed/pages/page-0").text
    )
    second = publish(client, owner, site)
    assert (
        "Private edited text" in client.get("/public/sites/indexed/pages/page-0").text
    )
    changed = client.get(
        "/public/sites/indexed/pages/page-0",
        params={"expected_release_id": first["release_id"]},
    )
    assert (
        changed.status_code == 409 and changed.json()["code"] == "SITE_RELEASE_CHANGED"
    )
    assert (
        client.post(
            f"/sites/{site['id']}/releases/{first['release_id']}/activate",
            headers=owner,
        ).status_code
        == 200
    )
    assert "First release" in client.get("/public/sites/indexed/pages/page-0").text
    assert (
        client.post(f"/sites/{site['id']}/unpublish", headers=owner).status_code == 200
    )
    assert client.get("/public/sites/indexed/pages/page-0").status_code == 404
    assert client.get("/s/indexed/page-0").status_code == 404
    assert (
        client.post(
            f"/sites/{site['id']}/releases/{second['release_id']}/activate",
            headers=owner,
        ).status_code
        == 200
    )
    assert (
        "Private edited text" in client.get("/public/sites/indexed/pages/page-0").text
    )


def test_failed_page_persistence_rolls_back_pointer_and_all_new_rows(
    client, owner, document, monkeypatch
):
    save(client, owner, document, [paragraph("Still active")])
    site, _ = create_site(client, owner, document)
    first = publish(client, owner, site)
    bindings, count = release_bindings(client, first["release_id"])
    save(client, owner, document, [paragraph("Failed new release")])
    persist = SitePageRepository.persist

    async def fail_after_flush(self, *args, **kwargs):
        await persist(self, *args, **kwargs)
        await self.session.flush()
        raise SiteError("SITE_STORAGE_UNAVAILABLE", "发布保存失败", 503)

    monkeypatch.setattr(SitePageRepository, "persist", fail_after_flush)
    rejected = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert rejected.status_code == 503, rejected.text
    assert (
        client.get("/public/sites/indexed").json()["data"]["release_id"]
        == first["release_id"]
    )
    assert "Still active" in client.get("/public/sites/indexed/pages/page-0").text
    assert release_bindings(client, first["release_id"]) == (bindings, count)


def test_old_full_snapshot_is_read_only_and_remains_activatable(
    client, owner, document
):
    save(client, owner, document, [paragraph("Historical body")])
    site, _ = create_site(client, owner, document)
    original = publish(client, owner, site)

    async def downgrade():
        async with client.app.state.session_factory() as session:
            await session.execute(
                update(SiteRelease)
                .where(SiteRelease.id == UUID(original["release_id"]))
                .values(snapshot=original)
            )
            await session.commit()

    client.portal.call(downgrade)
    page_cache.clear()
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", capture)
    try:
        assert (
            "Historical body" in client.get("/public/sites/indexed/pages/page-0").text
        )
        assert client.get("/public/sites/indexed/manifest").status_code == 200
        assert client.get("/public/sites/indexed/search").status_code == 200
        assert client.get("/public/sites/indexed").json()["data"] == original
        assert all(
            not sql.startswith(("insert ", "update ", "delete ")) for sql in statements
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    save(client, owner, document, [paragraph("New indexed body")])
    publish(client, owner, site)
    assert (
        client.post(
            f"/sites/{site['id']}/releases/{original['release_id']}/activate",
            headers=owner,
        ).status_code
        == 200
    )
    assert "Historical body" in client.get("/s/indexed/page-0").text


def test_immutable_cache_does_not_retain_oversized_pages_or_expose_mutable_state():
    cache = ImmutablePageCache(max_bytes=100, max_entries=2, max_page_bytes=60)
    for key in ["a", "b", "c"]:
        cache.put((key,), {"body": "x" * 30})
    assert cache.byte_size <= 100 and cache.get(("a",)) is None
    copy = cache.get(("c",))
    copy["body"] = "poisoned"
    assert cache.get(("c",))["body"] == "x" * 30
    cache.put(("oversized",), {"body": "y" * 1000})
    assert cache.get(("oversized",)) is None and cache.byte_size <= 100


def test_oversized_public_page_remains_readable_without_entering_cache(
    client, owner, document
):
    text = "Oversized body " + "x" * (2 * 1024 * 1024)
    save(client, owner, document, [paragraph(text)])
    site, _ = create_site(client, owner, document)
    publish(client, owner, site)
    page_cache.clear()
    response = client.get("/public/sites/indexed/pages/page-0")
    assert response.status_code == 200 and "Oversized body" in response.text
    assert page_cache.byte_size == 0
