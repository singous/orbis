from __future__ import annotations

import json
from uuid import UUID, uuid4


def source_config(notebook_id: str, **source_overrides):
    return {
        "name": "Notebook handbook",
        "slug": "notebook-handbook",
        "navigation": [],
        "source": {
            "kind": "notebooks",
            "notebooks": [{"notebook_id": notebook_id}],
            "excluded_note_ids": [],
            "page_overrides": [],
            **source_overrides,
        },
    }


def add_note(client, owner, notebook_id, title, parent_id=None, sort_order=0):
    response = client.post(
        "/notes",
        headers=owner,
        json={
            "notebook_id": notebook_id,
            "title": title,
            "parent_id": parent_id,
            "sort_order": sort_order,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def create_linked_site(client, owner, notebook_id, **overrides):
    response = client.post(
        "/sites", headers=owner, json=source_config(notebook_id, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def preview(client, owner, site_id):
    response = client.get(f"/sites/{site_id}/preview", headers=owner)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def publish(client, owner, site_id, fingerprint):
    return client.post(
        f"/sites/{site_id}/publish",
        headers=owner,
        json={"expected_source_fingerprint": fingerprint},
    )


def manual_config(*pages, name="Manual handbook", slug="manual-handbook"):
    return {
        "name": name,
        "slug": slug,
        "navigation": [
            {
                "note_id": page["id"],
                "slug": page_slug,
                "title": page["title"],
                "group": None,
            }
            for page, page_slug in pages
        ],
    }


def test_notebook_binding_includes_all_pages_and_preserves_readable_parents(
    client, owner, document
):
    child = add_note(client, owner, document["notebook_id"], "Child", document["id"])
    add_note(client, owner, document["notebook_id"], "Grandchild", child["id"])
    for i in range(22):
        add_note(client, owner, document["notebook_id"], f"Page {i}", sort_order=i + 1)
    site = create_linked_site(client, owner, document["notebook_id"])
    draft = preview(client, owner, site["id"])
    assert len(draft["pages"]) == 25
    first, second, third = draft["pages"][:3]
    assert [p["title"] for p in [first, second, third]] == [
        "Internal document",
        "Child",
        "Grandchild",
    ]
    assert first["parent_slug"] is None
    assert second["parent_slug"] == first["slug"]
    assert third["parent_slug"] == second["slug"]
    assert all(page["section"] == "Internal notebook" for page in draft["pages"])
    assert client.get("/public/sites/notebook-handbook").status_code == 404
    released = publish(client, owner, site["id"], draft["source_fingerprint"])
    assert released.status_code == 200, released.text
    public = client.get("/public/sites/notebook-handbook").json()["data"]
    assert len(public["pages"]) == 25
    for internal in [
        document["id"],
        document["notebook_id"],
        document["workspace_id"],
        child["id"],
    ]:
        assert internal not in json.dumps(public)
    assert "source" not in public and "source_fingerprint" not in public


def test_source_edits_are_pending_and_published_paths_survive_renaming(
    client, owner, document
):
    site = create_linked_site(client, owner, document["notebook_id"])
    before = preview(client, owner, site["id"])
    original = publish(client, owner, site["id"], before["source_fingerprint"])
    assert original.status_code == 200, original.text
    slug = original.json()["data"]["pages"][0]["slug"]
    changed = client.patch(
        f"/notes/{document['id']}", headers=owner, json={"title": "Renamed page"}
    )
    assert changed.status_code == 200, changed.text
    fresh = preview(client, owner, site["id"])
    assert fresh["pages"][0]["title"] == "Renamed page"
    assert fresh["pages"][0]["slug"] == slug
    assert fresh["source_fingerprint"] != before["source_fingerprint"]
    conflict = publish(client, owner, site["id"], before["source_fingerprint"])
    assert conflict.status_code == 409, conflict.text
    assert (
        client.get("/public/sites/notebook-handbook").json()["data"]
        == original.json()["data"]
    )
    state = client.get(f"/sites/{site['id']}/sources", headers=owner).json()["data"]
    assert [p["note_id"] for p in state["changes"]["modified"]] == [document["id"]]
    next_release = publish(client, owner, site["id"], fresh["source_fingerprint"])
    assert next_release.status_code == 200, next_release.text
    assert next_release.json()["data"]["pages"][0]["slug"] == slug


def test_source_exclusions_remove_subtrees_and_overlaps_do_not_duplicate_pages(
    client, owner, document
):
    child = add_note(
        client, owner, document["notebook_id"], "Private child", document["id"]
    )
    add_note(client, owner, document["notebook_id"], "Private descendant", child["id"])
    site = create_linked_site(
        client,
        owner,
        document["notebook_id"],
        notebooks=[
            {"notebook_id": document["notebook_id"]},
            {"notebook_id": document["notebook_id"], "root_note_id": document["id"]},
        ],
        excluded_note_ids=[child["id"]],
    )
    draft = preview(client, owner, site["id"])
    assert [p["title"] for p in draft["pages"]] == ["Internal document"]
    resolved = client.get(f"/sites/{site['id']}/sources", headers=owner).json()["data"]
    assert resolved["excluded_count"] == 2
    assert len(resolved["changes"]["added"]) == 1


def test_legacy_config_save_preserves_source_and_branding(client, owner, document):
    config = source_config(document["notebook_id"])
    config["branding"] = {
        "theme": "dark",
        "links": [{"label": "Support", "url": "https://example.com/help"}],
    }
    response = client.post("/sites", headers=owner, json=config)
    assert response.status_code == 201, response.text
    site = response.json()["data"]
    legacy = {
        "name": "New name",
        "slug": site["slug"],
        "navigation": [],
        "expected_version": site["config_version"],
    }
    updated = client.put(f"/sites/{site['id']}", headers=owner, json=legacy)
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["source"] == site["source"]
    assert updated.json()["data"]["branding"] == site["branding"]
    assert len(preview(client, owner, site["id"])["pages"]) == 1


def test_explicit_page_path_change_keeps_redirect_and_old_release_can_be_restored(
    client, owner, document
):
    site = create_linked_site(client, owner, document["notebook_id"])
    first = publish(
        client,
        owner,
        site["id"],
        preview(client, owner, site["id"])["source_fingerprint"],
    ).json()["data"]
    old_path = first["pages"][0]["slug"]
    config = source_config(
        document["notebook_id"],
        page_overrides=[{"note_id": document["id"], "slug": "guides/start"}],
    )
    response = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={**config, "expected_version": site["config_version"]},
    )
    assert response.status_code == 200, response.text
    updated = publish(
        client,
        owner,
        site["id"],
        preview(client, owner, site["id"])["source_fingerprint"],
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["redirects"][old_path] == "guides/start"
    restored = client.post(
        f"/sites/{site['id']}/releases/{first['release_id']}/activate", headers=owner
    )
    assert restored.status_code == 200, restored.text
    assert client.get("/public/sites/notebook-handbook").json()["data"] == first


def test_manual_page_can_replace_previous_page_at_same_slug_and_keep_it_on_conversion(
    client, owner, document
):
    replacement = add_note(
        client, owner, document["notebook_id"], "Replacement", sort_order=1
    )
    site = client.post(
        "/sites",
        headers=owner,
        json=manual_config((document, "start")),
    ).json()["data"]
    first = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert first.status_code == 200, first.text

    replaced = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={
            **manual_config((replacement, "start")),
            "expected_version": site["config_version"],
        },
    )
    assert replaced.status_code == 200, replaced.text
    second = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert second.status_code == 200, second.text
    assert [
        (page["title"], page["slug"]) for page in second.json()["data"]["pages"]
    ] == [("Replacement", "start")]

    notebook_source = source_config(document["notebook_id"])
    notebook_source.update(
        slug="manual-handbook",
        expected_version=replaced.json()["data"]["config_version"],
    )
    converted = client.put(f"/sites/{site['id']}", headers=owner, json=notebook_source)
    assert converted.status_code == 200, converted.text
    pages = preview(client, owner, site["id"])["pages"]
    slugs = {page["title"]: page["slug"] for page in pages}
    assert slugs["Replacement"] == "start"
    assert slugs["Internal document"] != "start"


def test_manual_pages_can_swap_published_slugs(client, owner, document):
    second = add_note(client, owner, document["notebook_id"], "Second", sort_order=1)
    site = client.post(
        "/sites",
        headers=owner,
        json=manual_config((document, "first"), (second, "second")),
    ).json()["data"]
    released = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert released.status_code == 200, released.text

    swapped = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={
            **manual_config((document, "second"), (second, "first")),
            "expected_version": site["config_version"],
        },
    )
    assert swapped.status_code == 200, swapped.text
    next_release = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert next_release.status_code == 200, next_release.text
    assert {
        page["title"]: page["slug"] for page in next_release.json()["data"]["pages"]
    } == {"Internal document": "second", "Second": "first"}


def test_manual_publish_rejects_a_stale_fingerprint_and_keeps_no_body_compatibility(
    client, owner, document
):
    site = client.post(
        "/sites", headers=owner, json=manual_config((document, "start"))
    ).json()["data"]
    shown = preview(client, owner, site["id"])
    changed = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "text": "Changed after preview"}
                            ],
                        }
                    ],
                },
            },
        },
    )
    assert changed.status_code == 200, changed.text

    stale = publish(client, owner, site["id"], shown["source_fingerprint"])
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "SITE_SOURCE_CONFLICT"

    legacy = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["data"]["pages"][0]["plain_text"] == "Changed after preview"


def test_unknown_source_and_root_outside_notebook_are_rejected(client, owner, document):
    invalid = client.post("/sites", headers=owner, json=source_config(str(uuid4())))
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "SITE_SOURCE_INVALID"
    other = client.post("/notebooks", headers=owner, json={"title": "Other"}).json()[
        "data"
    ]
    wrong_root = client.post(
        "/sites",
        headers=owner,
        json=source_config(
            other["id"],
            notebooks=[{"notebook_id": other["id"], "root_note_id": document["id"]}],
        ),
    )
    assert wrong_root.status_code == 422
    assert wrong_root.json()["code"] == "SITE_SOURCE_INVALID"


def test_content_change_during_publish_preserves_active_release(
    client, owner, document, monkeypatch
):
    from orbis_user_api.application import sites
    from orbis_user_api.models.note import NoteContent
    from sqlalchemy import update

    site = create_linked_site(client, owner, document["notebook_id"])
    fingerprint = preview(client, owner, site["id"])["source_fingerprint"]
    original = publish(client, owner, site["id"], fingerprint).json()["data"]
    build = sites.build_snapshot

    async def concurrent_change(record, session, *, url_policy):
        snapshot = await build(record, session, url_policy=url_policy)
        async with client.app.state.session_factory() as other:
            await other.execute(
                update(NoteContent)
                .where(NoteContent.note_id == UUID(document["id"]))
                .values(content_version=NoteContent.content_version + 1)
            )
            await other.commit()
        return snapshot

    monkeypatch.setattr(sites, "build_snapshot", concurrent_change)
    result = publish(client, owner, site["id"], fingerprint)
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "SITE_SOURCE_CONFLICT"
    assert client.get("/public/sites/notebook-handbook").json()["data"] == original
    history = client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"]
    assert history["pagination"]["total"] == 1


def test_archived_parent_removes_subtree_only_on_next_release(client, owner, document):
    child = add_note(client, owner, document["notebook_id"], "Child", document["id"])
    survivor = add_note(
        client, owner, document["notebook_id"], "Public survivor", sort_order=1
    )
    site = create_linked_site(client, owner, document["notebook_id"])
    first = publish(
        client,
        owner,
        site["id"],
        preview(client, owner, site["id"])["source_fingerprint"],
    ).json()["data"]
    archived = client.post(f"/notes/{document['id']}/archive", headers=owner)
    assert archived.status_code == 200, archived.text
    resolved = client.get(f"/sites/{site['id']}/sources", headers=owner).json()["data"]
    assert [p["note_id"] for p in resolved["pages"]] == [survivor["id"]]
    assert {p["note_id"] for p in resolved["changes"]["removed"]} == {
        document["id"],
        child["id"],
    }
    assert client.get("/public/sites/notebook-handbook").json()["data"] == first
    assert (
        publish(client, owner, site["id"], resolved["source_fingerprint"]).status_code
        == 200
    )
    archived_book = client.post(
        f"/notebooks/{document['notebook_id']}/archive", headers=owner
    )
    assert archived_book.status_code == 200
    assert client.get(f"/sites/{site['id']}/sources", headers=owner).status_code == 422
    assert client.get("/public/sites/notebook-handbook").status_code == 200


def test_notebook_growth_over_limit_is_not_silently_truncated(client, owner, document):
    site = create_linked_site(client, owner, document["notebook_id"])
    before = publish(
        client,
        owner,
        site["id"],
        preview(client, owner, site["id"])["source_fingerprint"],
    ).json()["data"]
    for i in range(200):
        add_note(client, owner, document["notebook_id"], f"Additional {i}")
    result = client.get(f"/sites/{site['id']}/sources", headers=owner)
    assert result.status_code == 422, result.text
    assert result.json()["code"] == "SITE_TOO_MANY_PAGES"
    assert client.get("/public/sites/notebook-handbook").json()["data"] == before


def test_converting_legacy_manual_site_preserves_existing_public_path(
    client, owner, document
):
    from orbis_user_api.models.site import Site, SiteRelease
    from sqlalchemy import update

    config = {
        "name": "Legacy",
        "slug": "legacy",
        "navigation": [
            {
                "note_id": document["id"],
                "slug": "custom-start",
                "title": "Welcome",
                "group": None,
            }
        ],
    }
    site = client.post("/sites", headers=owner, json=config).json()["data"]
    release = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]

    async def remove_legacy_tracking():
        async with client.app.state.session_factory() as session:
            await session.execute(
                update(Site).where(Site.id == UUID(site["id"])).values(page_registry={})
            )
            await session.execute(
                update(SiteRelease)
                .where(SiteRelease.id == UUID(release["release_id"]))
                .values(source_manifest={})
            )
            await session.commit()

    client.portal.call(remove_legacy_tracking)
    payload = source_config(document["notebook_id"])
    payload.update(slug="legacy", expected_version=site["config_version"])
    saved = client.put(f"/sites/{site['id']}", headers=owner, json=payload)
    assert saved.status_code == 200, saved.text
    assert preview(client, owner, site["id"])["pages"][0]["slug"] == "custom-start"
    assert client.get("/public/sites/legacy").json()["data"] == release


def test_same_named_notebooks_have_distinct_sections(client, owner, document):
    other = client.post(
        "/notebooks", headers=owner, json={"title": "Internal notebook"}
    ).json()["data"]
    add_note(client, owner, other["id"], "Other book page")
    site = create_linked_site(
        client,
        owner,
        document["notebook_id"],
        notebooks=[
            {"notebook_id": document["notebook_id"]},
            {"notebook_id": other["id"]},
        ],
    )
    pages = preview(client, owner, site["id"])["pages"]
    assert len(pages) == 2
    assert len({page["section"] for page in pages}) == 2


def test_legacy_release_diff_includes_removed_pages_without_source_identity(
    client, owner, document
):
    from orbis_user_api.models.site import Site, SiteRelease
    from sqlalchemy import update

    second = add_note(client, owner, document["notebook_id"], "Second")
    config = {
        "name": "Legacy",
        "slug": "legacy",
        "navigation": [
            {
                "note_id": document["id"],
                "slug": "first",
                "title": "First",
                "group": None,
            },
            {
                "note_id": second["id"],
                "slug": "second",
                "title": "Second",
                "group": None,
            },
        ],
    }
    site = client.post("/sites", headers=owner, json=config).json()["data"]
    release = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]

    async def remove_tracking():
        async with client.app.state.session_factory() as session:
            await session.execute(
                update(Site).where(Site.id == UUID(site["id"])).values(page_registry={})
            )
            await session.execute(
                update(SiteRelease)
                .where(SiteRelease.id == UUID(release["release_id"]))
                .values(source_manifest={})
            )
            await session.commit()

    client.portal.call(remove_tracking)
    config["navigation"] = config["navigation"][1:]
    saved = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={**config, "expected_version": site["config_version"]},
    )
    assert saved.status_code == 200, saved.text
    changes = client.get(f"/sites/{site['id']}/sources", headers=owner).json()["data"][
        "changes"
    ]
    assert [page["slug"] for page in changes["removed"]] == ["first"]
    assert changes["removed"][0]["note_id"] is None


def test_legacy_release_without_new_metadata_only_reports_real_changes(
    client, owner, document
):
    from copy import deepcopy

    from orbis_user_api.models.site import SiteRelease
    from sqlalchemy import update

    site = client.post(
        "/sites", headers=owner, json=manual_config((document, "start"))
    ).json()["data"]
    release = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]

    async def downgrade_snapshot():
        async with client.app.state.session_factory() as session:
            record = await session.get(SiteRelease, UUID(release["release_id"]))
            snapshot = deepcopy(record.snapshot)
            for key in ("description", "updated_at_ms", "parent_slug", "section"):
                snapshot["pages"][0].pop(key)
            await session.execute(
                update(SiteRelease)
                .where(SiteRelease.id == record.id)
                .values(snapshot=snapshot, source_manifest={})
            )
            await session.commit()

    client.portal.call(downgrade_snapshot)
    unchanged = client.get(f"/sites/{site['id']}/sources", headers=owner)
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["data"]["changes"]["modified"] == []

    renamed = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={
            **manual_config(({**document, "title": "Renamed"}, "start")),
            "expected_version": site["config_version"],
        },
    )
    assert renamed.status_code == 200, renamed.text
    changed = client.get(f"/sites/{site['id']}/sources", headers=owner)
    assert changed.status_code == 200, changed.text
    assert [
        page["note_id"] for page in changed.json()["data"]["changes"]["modified"]
    ] == [document["id"]]


def test_manual_reuses_removed_slug_and_converts_before_republication(
    client, owner, document
):
    other = add_note(client, owner, document["notebook_id"], "Other")
    replacement = add_note(client, owner, document["notebook_id"], "Replacement")
    site = client.post(
        "/sites",
        headers=owner,
        json=manual_config((document, "start"), (other, "other")),
    ).json()["data"]
    assert client.post(f"/sites/{site['id']}/publish", headers=owner).status_code == 200
    removed = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={**manual_config((other, "other")), "expected_version": 1},
    )
    assert removed.status_code == 200, removed.text
    reused = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={
            **manual_config((other, "other"), (replacement, "start")),
            "expected_version": 2,
        },
    )
    assert reused.status_code == 200, reused.text
    converted = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={
            **source_config(document["notebook_id"]),
            "slug": "manual-handbook",
            "expected_version": 3,
        },
    )
    assert converted.status_code == 200, converted.text
    paths = {
        page["title"]: page["slug"]
        for page in preview(client, owner, site["id"])["pages"]
    }
    assert paths["Replacement"] == "start"
    assert paths["Other"] == "other"
    assert paths["Internal document"] not in {"start", "other"}


def test_configuration_save_cannot_erase_registry_from_concurrent_publish(
    client, owner, document, monkeypatch
):
    from orbis_user_api.application import sites
    from orbis_user_api.application.site_urls import PublicUrlPolicy
    from orbis_user_api.models.site import Site
    from orbis_user_api.models.user import User

    site = create_linked_site(client, owner, document["notebook_id"])
    resolve = sites.resolve_site_source
    published = []

    async def publish_while_validating(candidate, session):
        resolved = await resolve(candidate, session)
        if candidate.release_sequence is None and not published:
            async with client.app.state.session_factory() as other:
                record = await other.get(Site, UUID(site["id"]))
                actor = await other.get(User, UUID(document["owner_id"]))
                before = await resolve(record, other)
                release = await sites.publish_site(
                    record.id,
                    actor,
                    other,
                    url_policy=PublicUrlPolicy(),
                    expected_source_fingerprint=before.fingerprint,
                )
                published.append(release)
        return resolved

    monkeypatch.setattr(sites, "resolve_site_source", publish_while_validating)
    payload = {
        **source_config(document["notebook_id"]),
        "name": "Concurrent settings",
        "expected_version": site["config_version"],
    }
    result = client.put(f"/sites/{site['id']}", headers=owner, json=payload)
    assert published
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "SITE_VERSION_CONFLICT"
    assert client.get("/public/sites/notebook-handbook").json()["data"] == published[
        0
    ].model_dump(mode="json")
