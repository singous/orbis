from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from orbis_user_api.core.ids import new_uuidv7

PASSWORD = "correct horse battery staple"


def blocks(text: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]},
            ],
        },
    }


def config(note_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "name": "Public handbook",
        "slug": "handbook",
        "description": "Welcome",
        "site_kind": "handbook",
        "accent_color": "#0f766e",
        "navigation": [
            {
                "note_id": note_id,
                "slug": "start",
                "title": "Getting started",
                "group": "Basics",
            },
        ],
        **overrides,
    }


def create_site(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
    **overrides: Any,
):
    response = client.post(
        "/sites", headers=owner, json=config(document["id"], **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def save_content(
    client: TestClient, owner: dict[str, str], note_id: str, body: dict[str, Any]
):
    current = client.get(f"/notes/{note_id}/content", headers=owner).json()["data"]
    response = client.put(
        f"/notes/{note_id}/content",
        headers=owner,
        json={
            "expected_version": current["content_version"],
            "blocks": body,
        },
    )
    assert response.status_code == 200, response.text


def invite(client: TestClient, owner: dict[str, str], tmp_path: Path, role: str):
    email = f"{role}@example.com"
    response = client.post(
        "/workspace/invitations", headers=owner, json={"email": email, "role": role}
    )
    assert response.status_code == 201, response.text
    messages = [json.loads(p.read_text()) for p in (tmp_path / "outbox").glob("*.json")]
    message = next(m for m in messages if m["recipient"] == email)
    accepted = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": role,
        },
    )
    assert accepted.status_code == 201, accepted.text
    return {"Authorization": f"Bearer {accepted.json()['data']['access_token']}"}


def test_publish_keeps_content_config_navigation_and_slug_immutable_until_explicit_release(
    client,
    owner,
    document,
):
    save_content(client, owner, document["id"], blocks("Published original"))
    site = create_site(client, owner, document)
    assert site["config_version"] == 1
    assert site["published_release_id"] is None
    assert UUID(site["id"]).version == 7
    assert client.get("/public/sites/handbook").status_code == 404
    assert client.get(f"/sites/{site['id']}/preview").status_code == 401
    preview = client.get(f"/sites/{site['id']}/preview", headers=owner).json()["data"]
    assert preview["release_id"] is None
    assert preview["pages"][0]["title"] == "Getting started"
    assert preview["pages"][0]["plain_text"] == "Published original"
    published = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert published.status_code == 200, published.text
    first = published.json()["data"]
    assert first["release_number"] == 1 and first["published_at_ms"] > 0
    assert UUID(first["release_id"]).version == 7
    assert client.get("/public/sites/handbook").json()["data"] == first
    public_text = json.dumps(first)
    for private_id in (
        document["id"],
        document["workspace_id"],
        document["owner_id"],
        document["notebook_id"],
    ):
        assert private_id not in public_text
    save_content(client, owner, document["id"], blocks("Private draft"))
    changed = config(
        document["id"],
        name="Changed title",
        slug="new-handbook",
        description="Changed",
        accent_color="#115e59",
    )
    changed["navigation"][0].update(
        slug="new-start", title="New navigation", group="New group"
    )
    updated = client.put(
        f"/sites/{site['id']}", headers=owner, json={**changed, "expected_version": 1}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["config_version"] == 2
    assert updated.json()["data"]["published_slug"] == "handbook"
    assert client.get("/public/sites/handbook").json()["data"] == first
    assert client.get("/public/sites/new-handbook").status_code == 404
    second = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    assert second["release_number"] == 2
    assert second["pages"][0]["plain_text"] == "Private draft"
    assert second["pages"][0]["slug"] == "new-start"
    assert second["name"] == "Changed title" and second["accent_color"] == "#115e59"
    assert client.get("/public/sites/new-handbook").json()["data"] == second
    assert client.get("/public/sites/handbook").status_code == 404
    history = client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"]
    assert [item["id"] for item in history["items"]] == [
        second["release_id"],
        first["release_id"],
    ]
    assert [item["is_active"] for item in history["items"]] == [True, False]
    activated = client.post(
        f"/sites/{site['id']}/releases/{first['release_id']}/activate", headers=owner
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["data"]["published_release_id"] == first["release_id"]
    assert client.get("/public/sites/handbook").json()["data"] == first
    assert client.get("/public/sites/new-handbook").status_code == 404
    withdrawn = client.post(f"/sites/{site['id']}/unpublish", headers=owner)
    assert withdrawn.status_code == 200
    assert withdrawn.json()["data"]["published_release_id"] is None
    assert client.get("/public/sites/handbook").status_code == 404
    restored = client.post(
        f"/sites/{site['id']}/releases/{second['release_id']}/activate", headers=owner
    )
    assert restored.status_code == 200
    assert client.get("/public/sites/new-handbook").json()["data"] == second


def test_site_lists_releases_and_independent_navigation_are_paginated(
    client, owner, document
):
    second_doc = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": document["notebook_id"], "title": "Second"},
    ).json()["data"]
    navigation = [
        config(second_doc["id"])["navigation"][0],
        {**config(document["id"])["navigation"][0], "slug": "last"},
    ]
    site = create_site(client, owner, document, navigation=navigation)
    create_site(client, owner, document, slug="help", site_kind="help")
    listing = client.get("/sites?page=1&page_size=1", headers=owner).json()["data"]
    assert len(listing["items"]) == 1
    assert listing["pagination"]["total"] == 2 and listing["pagination"]["has_next"]
    for _ in range(2):
        published = client.post(f"/sites/{site['id']}/publish", headers=owner)
        assert published.status_code == 200, published.text
    assert [p["slug"] for p in published.json()["data"]["pages"]] == ["start", "last"]
    history = client.get(
        f"/sites/{site['id']}/releases?page_size=1", headers=owner
    ).json()["data"]
    assert history["pagination"]["total"] == 2 and history["pagination"]["has_next"]


def test_config_saves_use_expected_version_and_slug_reservations(
    client, owner, document
):
    site = create_site(client, owner, document)
    assert (
        client.post("/sites", headers=owner, json=config(document["id"])).status_code
        == 409
    )
    assert client.post(f"/sites/{site['id']}/publish", headers=owner).status_code == 200
    changed = config(document["id"], slug="draft-slug")
    assert (
        client.put(
            f"/sites/{site['id']}",
            headers=owner,
            json={**changed, "expected_version": 1},
        ).status_code
        == 200
    )
    stale = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={**changed, "name": "Stale", "expected_version": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "SITE_VERSION_CONFLICT"
    assert (
        client.get(f"/sites/{site['id']}", headers=owner).json()["data"]["name"]
        == site["name"]
    )
    assert (
        client.post("/sites", headers=owner, json=config(document["id"])).status_code
        == 409
    )


@pytest.mark.parametrize(
    "role,can_configure,can_publish",
    [("normal", False, False), ("editor", True, False), ("admin", True, True)],
)
def test_member_site_permissions(
    client, owner, document, tmp_path, role, can_configure, can_publish
):
    site = create_site(client, owner, document)
    released = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    member = invite(client, owner, tmp_path, role)
    for suffix in ("", "/preview", "/releases"):
        assert (
            client.get(f"/sites/{site['id']}{suffix}", headers=member).status_code
            == 200
        )
    saved = client.put(
        f"/sites/{site['id']}",
        headers=member,
        json={**config(document["id"]), "expected_version": 1},
    )
    assert saved.status_code == (200 if can_configure else 403)
    created = client.post(
        "/sites", headers=member, json=config(document["id"], slug="member-site")
    )
    assert created.status_code == (201 if can_configure else 403)
    for suffix in (
        "/publish",
        f"/releases/{released['release_id']}/activate",
        "/unpublish",
    ):
        assert client.post(
            f"/sites/{site['id']}{suffix}", headers=member
        ).status_code == (200 if can_publish else 403)


@pytest.mark.parametrize(
    "patch",
    [
        {"slug": "../secret"},
        {"slug": "UPPER"},
        {"slug": "a/b"},
        {"slug": "a%2fb"},
        {"accent_color": "url(javascript:alert(1))"},
        {"name": "   "},
        {"site_kind": "unknown"},
    ],
)
def test_invalid_site_config_is_rejected(client, owner, document, patch):
    response = client.post(
        "/sites", headers=owner, json=config(document["id"], **patch)
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("slug", ["../private", "a/b", "", "javascript:alert(1)"])
def test_invalid_page_slug_is_rejected(client, owner, document, slug):
    payload = config(document["id"])
    payload["navigation"][0]["slug"] = slug
    assert client.post("/sites", headers=owner, json=payload).status_code == 422


def test_duplicate_navigation_slug_and_note_are_rejected(client, owner, document):
    payload = config(document["id"])
    payload["navigation"] *= 2
    assert client.post("/sites", headers=owner, json=payload).status_code == 422
    payload["navigation"] = deepcopy(payload["navigation"])
    payload["navigation"][1] = {**payload["navigation"][1], "slug": "another"}
    assert client.post("/sites", headers=owner, json=payload).status_code == 422


@pytest.mark.parametrize("archived_resource", ["note", "parent", "notebook", "group"])
def test_inactive_documents_cannot_publish_and_failure_preserves_live_snapshot(
    client, owner, document, archived_resource
):
    child = client.post(
        "/notes",
        headers=owner,
        json={
            "notebook_id": document["notebook_id"],
            "parent_id": document["id"],
            "title": "Child",
        },
    ).json()["data"]
    site = create_site(client, owner, child)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    if archived_resource == "note":
        route = f"/notes/{child['id']}/archive"
    elif archived_resource == "parent":
        route = f"/notes/{document['id']}/archive"
    elif archived_resource == "notebook":
        route = f"/notebooks/{document['notebook_id']}/archive"
    else:
        notebook = next(
            item
            for item in client.get("/notebooks", headers=owner).json()["data"]["items"]
            if item["id"] == document["notebook_id"]
        )
        route = f"/document-groups/{notebook['group_id']}/archive"
    # Default groups cannot be archived via API; changing their status models an inactive ancestor.
    if archived_resource == "group":
        from orbis_user_api.models.note import NoteGroup

        async def archive_group():
            async with client.app.state.session_factory() as session:
                group = await session.get(NoteGroup, UUID(notebook["group_id"]))
                group.status = "archived"
                await session.commit()

        client.portal.call(archive_group)
    else:
        assert client.post(route, headers=owner).status_code == 200
    for suffix in ("publish", "preview"):
        method = client.post if suffix == "publish" else client.get
        rejected = method(f"/sites/{site['id']}/{suffix}", headers=owner)
        assert rejected.status_code == 422, rejected.text
    assert client.get("/public/sites/handbook").json()["data"] == original
    history = client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"]
    assert history["pagination"]["total"] == 1


def test_unknown_and_foreign_workspace_resources_are_not_accessible(
    client, owner, document
):
    site = create_site(client, owner, document)
    from orbis_user_api.models.user import User
    from orbis_user_api.models.workspace import Workspace, WorkspaceMember

    async def switch_workspace():
        async with client.app.state.session_factory() as session:
            user = await session.get(User, UUID(document["owner_id"]))
            workspace = Workspace(
                owner_id=user.id, name="Other workspace", workspace_type="private"
            )
            session.add(workspace)
            await session.flush()
            session.add(
                WorkspaceMember(
                    workspace_id=workspace.id,
                    user_id=user.id,
                    role="owner",
                    status="active",
                )
            )
            user.current_workspace_id = workspace.id
            await session.commit()

    client.portal.call(switch_workspace)
    for suffix in ("", "/preview", "/releases"):
        assert (
            client.get(f"/sites/{site['id']}{suffix}", headers=owner).status_code == 404
        )
    for suffix in ("/publish", "/unpublish", f"/releases/{new_uuidv7()}/activate"):
        assert (
            client.post(f"/sites/{site['id']}{suffix}", headers=owner).status_code
            == 404
        )
    assert (
        client.put(
            f"/sites/{site['id']}",
            headers=owner,
            json={**config(document["id"]), "expected_version": 1},
        ).status_code
        == 404
    )
    assert client.get("/sites", headers=owner).json()["data"]["items"] == []
    foreign = client.post(
        "/sites", headers=owner, json=config(document["id"], slug="foreign")
    )
    assert foreign.status_code == 422
    missing = client.post(
        "/sites", headers=owner, json=config(str(new_uuidv7()), slug="missing")
    )
    assert missing.status_code == 422


def test_empty_selection_can_be_prepared_but_not_published(client, owner, document):
    site = create_site(client, owner, document, navigation=[])
    assert client.get(f"/sites/{site['id']}/preview", headers=owner).status_code == 200
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 422
    assert client.get("/public/sites/handbook").status_code == 404


@pytest.mark.parametrize(
    "unsafe_url",
    [
        "javascript:alert(1)",
        "jAvAsCrIpT:alert(1)",
        "data:text/html,private",
        "blob:https://example.com/private",
        "/files/private",
        "//example.com/private",
        "https://user:password@example.com/private",
    ],
)
@pytest.mark.parametrize("format_version", [1, 2])
def test_unsafe_links_are_rejected_and_previous_release_survives(
    client, owner, document, unsafe_url, format_version
):
    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    if format_version == 1:
        content = blocks("Unsafe link")
        content["doc"]["content"][0]["content"][0]["marks"] = [
            {"type": "link", "attrs": {"href": unsafe_url}}
        ]
    else:
        content = {
            "schema_version": 2,
            "editor": "blocknote",
            "blocks": [
                {
                    "id": "private-block",
                    "type": "paragraph",
                    "props": {},
                    "content": [
                        {
                            "type": "link",
                            "href": unsafe_url,
                            "content": [
                                {"type": "text", "text": "Unsafe link", "styles": {}}
                            ],
                        },
                    ],
                },
            ],
        }
    save_content(client, owner, document["id"], content)
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "SITE_CONTENT_UNSAFE"
    assert client.get("/public/sites/handbook").json()["data"] == original


@pytest.mark.parametrize("media_type", ["image", "file", "audio", "video"])
def test_public_media_uses_only_safe_absolute_urls_and_strips_private_metadata(
    client, owner, document, media_type
):
    site = create_site(client, owner, document)
    content = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "private-block-id",
                "type": media_type,
                "props": {
                    "url": "https://cdn.example.com/asset",
                    "name": "Asset",
                    "caption": "Public caption",
                    "note_id": document["id"],
                    "private_token": "never-publish",
                },
                "content": [],
            },
        ],
    }
    save_content(client, owner, document["id"], content)
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 200, response.text
    public = response.json()["data"]
    public_body = json.dumps(public)
    assert (
        "https://cdn.example.com/asset" in public_body
        and "Public caption" in public_body
    )
    for secret in (
        "private-block-id",
        "private_token",
        "never-publish",
        document["id"],
    ):
        assert secret not in public_body
    content["blocks"][0]["props"]["url"] = "/files/private-download"
    save_content(client, owner, document["id"], content)
    rejected = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert rejected.status_code == 422
    assert client.get("/public/sites/handbook").json()["data"] == public


def test_release_cannot_be_activated_from_another_site(client, owner, document):
    first = create_site(client, owner, document)
    second = create_site(client, owner, document, slug="second-site")
    released = client.post(f"/sites/{first['id']}/publish", headers=owner).json()[
        "data"
    ]
    assert (
        client.post(
            f"/sites/{second['id']}/releases/{released['release_id']}/activate",
            headers=owner,
        ).status_code
        == 404
    )
    assert client.get("/public/sites/second-site").status_code == 404


def test_unknown_persisted_content_never_implicitly_publishes(client, owner, document):
    site = create_site(client, owner, document)
    from sqlalchemy import select

    from orbis_user_api.models.note import NoteContent

    async def replace_with_unknown_content():
        async with client.app.state.session_factory() as session:
            note_content = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(document["id"]))
            )
            note_content.blocks = {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [
                    {"id": "custom", "type": "iframe", "props": {"url": "/private"}},
                ],
            }
            await session.commit()

    client.portal.call(replace_with_unknown_content)
    rejected = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert rejected.status_code == 422
    assert client.get("/public/sites/handbook").status_code == 404


def test_database_publish_failure_rolls_back_active_pointer_and_release_number(
    client, owner, document
):
    from sqlalchemy import event
    from sqlalchemy.exc import IntegrityError

    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    engine = client.app.state.engine.sync_engine

    def reject_release_insert(
        connection, cursor, statement, parameters, context, executemany
    ):
        if statement.lstrip().upper().startswith("INSERT INTO SITE_RELEASES"):
            raise IntegrityError(
                statement, None, RuntimeError("Simulated release persistence failure")
            )

    event.listen(engine, "before_cursor_execute", reject_release_insert)
    try:
        failed = client.post(f"/sites/{site['id']}/publish", headers=owner)
        assert failed.status_code == 409, failed.text
    finally:
        event.remove(engine, "before_cursor_execute", reject_release_insert)
    assert client.get("/public/sites/handbook").json()["data"] == original
    history = client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"]
    assert history["pagination"]["total"] == 1
    recovered = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert recovered.status_code == 200
    assert recovered.json()["data"]["release_number"] == 2


def test_publish_detects_configuration_edit_during_snapshot_build(
    client, owner, document, monkeypatch
):
    from sqlalchemy import update

    from orbis_user_api.application import sites
    from orbis_user_api.models.site import Site

    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    original_build = sites.build_snapshot

    async def snapshot_with_concurrent_edit(record, session, *, url_policy):
        snapshot = await original_build(record, session, url_policy=url_policy)
        async with client.app.state.session_factory() as other_session:
            await other_session.execute(
                update(Site)
                .where(Site.id == record.id)
                .values(
                    name="Concurrent change",
                    config_version=Site.config_version + 1,
                )
            )
            await other_session.commit()
        return snapshot

    monkeypatch.setattr(sites, "build_snapshot", snapshot_with_concurrent_edit)
    failed = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert failed.status_code == 409, failed.text
    assert failed.json()["code"] == "SITE_VERSION_CONFLICT"
    assert client.get("/public/sites/handbook").json()["data"] == original
    assert (
        client.get(f"/sites/{site['id']}", headers=owner).json()["data"]["name"]
        == "Concurrent change"
    )
    assert (
        client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"][
            "pagination"
        ]["total"]
        == 1
    )


@pytest.mark.parametrize("table_format", ["native", "legacy"])
def test_public_v2_tables_keep_text_links_cells_and_layout_without_private_metadata(
    client, owner, document, table_format
):
    site = create_site(client, owner, document)
    link = {
        "type": "link",
        "href": "https://example.com/help",
        "content": [{"type": "text", "text": "Help", "styles": {"bold": True}}],
    }
    cells = [[{"type": "text", "text": "Title", "styles": {}}], [link]]
    content = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "private-table",
                "type": "table",
                "props": {},
                "content": {
                    "type": "tableContent",
                    "headerRows": 1,
                    "columnWidths": [120, None],
                    "rows": [
                        {
                            "cells": [
                                cells[0],
                                {
                                    "type": "tableCell",
                                    "content": cells[1],
                                    "props": {
                                        "textAlignment": "center",
                                        "note_id": document["id"],
                                    },
                                },
                            ],
                        }
                    ],
                }
                if table_format == "native"
                else [cells],
            }
        ],
    }
    save_content(client, owner, document["id"], content)
    published = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert published.status_code == 200, published.text
    page = published.json()["data"]["pages"][0]
    assert "Title" in page["plain_text"] and "Help" in page["plain_text"]
    assert "https://example.com/help" in json.dumps(page["blocks"])
    assert "private-table" not in json.dumps(page["blocks"])
    if table_format == "native":
        table = page["blocks"]["blocks"][0]["content"]
        assert table["headerRows"] == 1 and table["columnWidths"] == [120, None]
        assert table["rows"][0]["cells"][1]["props"] == {"textAlignment": "center"}


def test_public_links_support_external_email_and_heading_anchors(
    client, owner, document
):
    site = create_site(client, owner, document)
    content = blocks("Supported links")
    content["doc"]["content"][0]["content"] = [
        {
            "type": "text",
            "text": name,
            "marks": [{"type": "link", "attrs": {"href": href}}],
        }
        for name, href in [
            ("Web", "https://example.com/docs"),
            ("Email", "mailto:hello@example.com"),
            ("Heading", "#intro"),
        ]
    ]
    save_content(client, owner, document["id"], content)
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 200, response.text
    public = client.get(
        "/public/sites/handbook",
        headers={"Authorization": "Bearer invalid-private-token"},
    )
    assert public.status_code == 200
    assert public.headers["cache-control"] == "no-store"
    assert "mailto:hello@example.com" in public.text and "#intro" in public.text


def test_historical_slug_cannot_replace_another_sites_reserved_path(
    client, owner, document
):
    site = create_site(client, owner, document)
    first = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    changed = {**config(document["id"], slug="new-path"), "expected_version": 1}
    assert (
        client.put(f"/sites/{site['id']}", headers=owner, json=changed).status_code
        == 200
    )
    second = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    other = create_site(client, owner, document)
    assert other["id"] != site["id"]
    failed = client.post(
        f"/sites/{site['id']}/releases/{first['release_id']}/activate", headers=owner
    )
    assert failed.status_code == 409
    assert client.get("/public/sites/new-path").json()["data"] == second
    assert client.get("/public/sites/handbook").status_code == 404


def test_slug_claim_is_atomic_between_historical_activation_and_site_creation(
    client, owner, document, monkeypatch
):
    import anyio

    from orbis_user_api.application import sites

    site = create_site(client, owner, document)
    first = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    changed = {**config(document["id"], slug="new-path"), "expected_version": 1}
    assert (
        client.put(f"/sites/{site['id']}", headers=owner, json=changed).status_code
        == 200
    )
    current = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    original_check = sites._require_available_slug

    async def check_then_create_competing_site(slug, session, site_id=None):
        await original_check(slug, session, site_id)
        if str(site_id) == site["id"] and slug == "handbook":
            response = await anyio.to_thread.run_sync(
                lambda: client.post(
                    "/sites", headers=owner, json=config(document["id"])
                )
            )
            assert response.status_code == 201, response.text

    monkeypatch.setattr(
        sites, "_require_available_slug", check_then_create_competing_site
    )
    rejected = client.post(
        f"/sites/{site['id']}/releases/{first['release_id']}/activate", headers=owner
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["code"] == "SITE_SLUG_CONFLICT"
    assert client.get("/public/sites/new-path").json()["data"] == current
    assert client.get("/public/sites/handbook").status_code == 404


def _linked_content(url: str, content_kind: str) -> dict[str, Any]:
    if content_kind == "v1":
        body = blocks("Public link")
        body["doc"]["content"][0]["content"][0]["marks"] = [
            {
                "type": "link",
                "attrs": {"href": url},
            }
        ]
        return body
    block: dict[str, Any] = {
        "id": "link-source",
        "type": "paragraph",
        "props": {},
        "content": [
            {
                "type": "link",
                "href": url,
                "content": [{"type": "text", "text": "Public link", "styles": {}}],
            },
        ],
    }
    if content_kind == "media":
        block.update(
            type="image", props={"url": url, "caption": "Public image"}, content=[]
        )
    return {"schema_version": 2, "editor": "blocknote", "blocks": [block]}


@pytest.mark.parametrize("content_kind", ["v1", "v2", "media"])
@pytest.mark.parametrize(
    "url_template",
    [
        "http://testserver/notes/{note_id}/content?token=synthetic-review-token",
        "http://testserver/notes/{note_id}/content",
        "http://testserver/%6eotes/{note_id}/content",
        "https://orbis.example.test:443/documents/{note_id}",
        "http://orbis.example.test/documents/{note_id}",
        "https://orbis.example.test:8443/documents/{note_id}",
        "https://orbis.example.test/orbis/documents/{note_id}",
        "https://orbis.example.test/files/{note_id}",
    ],
)
def test_public_projection_rejects_absolute_internal_resources(
    client,
    owner,
    document,
    content_kind,
    url_template,
):
    client.app.state.settings.user_web_base_url = "https://orbis.example.test/orbis"
    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    assert (
        client.get(
            f"/notes/{document['id']}/content?token=synthetic-review-token"
        ).status_code
        == 401
    )
    url = url_template.format(note_id=document["id"])
    save_content(client, owner, document["id"], _linked_content(url, content_kind))
    for method, suffix in ((client.get, "preview"), (client.post, "publish")):
        response = method(f"/sites/{site['id']}/{suffix}", headers=owner)
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "SITE_CONTENT_UNSAFE"
    public = client.get("/public/sites/handbook")
    assert public.json()["data"] == original
    assert document["id"] not in public.text
    assert "synthetic-review-token" not in public.text


@pytest.mark.parametrize(
    "url",
    [
        "https://cdn.example.com/files/public.png?access_token=synthetic-access",
        "https://cdn.example.com/files/public.png?%74oken=synthetic-access",
        "https://cdn.example.com/files/public.png?X-Amz-Signature=synthetic-signature",
        "https://cdn.example.com/files/public.png?X-Goog-Credential=synthetic-credential",
        "https://cdn.example.com/files/public.png?q-signature=synthetic-signature",
        "https://cdn.example.com/files/public.png?OSSAccessKeyId=synthetic-key",
        "https://cdn.example.com/files/public.png#access_token=synthetic-fragment",
        "http://127.0.0.1:8080/files/private.png",
        "http://10.12.0.4/files/private.png",
        "http://[::1]/files/private.png",
        "http://storage.internal/files/private.png",
    ],
)
def test_public_projection_rejects_private_hosts_and_credential_urls(
    client, owner, document, url
):
    site = create_site(client, owner, document)
    save_content(client, owner, document["id"], _linked_content(url, "media"))
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "SITE_CONTENT_UNSAFE"
    assert client.get("/public/sites/handbook").status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "https://cdn.example.com/files/public.png?download=1&version=2",
        "https://external.example.com/documents/shared-guide",
        "https://orbis.example.test/s/help/getting-started",
        "https://orbis.example.test/orbis/s/help/getting-started",
        "https://orbis.example.test/public/sites/help",
    ],
)
def test_public_projection_keeps_explicit_public_links_and_external_file_paths(
    client, owner, document, url
):
    client.app.state.settings.user_web_base_url = "https://orbis.example.test/orbis"
    site = create_site(client, owner, document)
    save_content(client, owner, document["id"], _linked_content(url, "v2"))
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 200, response.text
    assert url in json.dumps(response.json()["data"])


@pytest.mark.parametrize("location", ["paragraph", "table"])
def test_partial_link_string_labels_publish_in_paragraphs_and_tables(
    client, owner, document, location
):
    site = create_site(client, owner, document)
    link = {"type": "link", "href": "https://example.com/help", "content": "Help label"}
    content = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "partial-link",
                "type": location,
                "props": {},
                "content": [link]
                if location == "paragraph"
                else {
                    "type": "tableContent",
                    "rows": [{"cells": [[link]]}],
                },
            }
        ],
    }
    save_content(client, owner, document["id"], content)
    for method, suffix in ((client.get, "preview"), (client.post, "publish")):
        response = method(f"/sites/{site['id']}/{suffix}", headers=owner)
        assert response.status_code == 200, response.text
        page = response.json()["data"]["pages"][0]
        assert page["plain_text"] == "Help label"
        public_content = page["blocks"]["blocks"][0]["content"]
        public_link = (
            public_content[0]
            if location == "paragraph"
            else public_content["rows"][0]["cells"][0][0]
        )
        assert public_link == link


def test_release_history_query_does_not_load_snapshot_payloads(client, owner, document):
    from sqlalchemy import event

    site = create_site(client, owner, document)
    published = client.post(f"/sites/{site['id']}/publish", headers=owner).json()[
        "data"
    ]
    statements: list[str] = []
    engine = client.app.state.engine.sync_engine

    def collect_release_queries(
        connection, cursor, statement, parameters, context, executemany
    ):
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "site_releases" in statement
        ):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", collect_release_queries)
    try:
        response = client.get(f"/sites/{site['id']}/releases", headers=owner)
    finally:
        event.remove(engine, "before_cursor_execute", collect_release_queries)
    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["id"] == published["release_id"]
    assert statements
    assert all("snapshot" not in statement for statement in statements), statements


@pytest.mark.parametrize(
    "canonical_host,url_host",
    [
        ("orbis.example.test", "orbis%2eexample.test"),
        ("orbis.example.test", "orb%69s.example.test"),
        ("orbis.example.test", "orbis.example.test."),
        ("orbis.example.test.", "orbis.example.test"),
        ("orbis.example.test", "orbis。example.test"),
        ("orbis.example.test", "ｏｒｂｉｓ.example.test"),
        ("bücher.example.test", "xn--bcher-kva.example.test"),
        ("xn--bcher-kva.example.test", "bücher.example.test"),
        ("bücher.example.test", "bu\u0308cher.example.test"),
        ("bücher.example.test", "b%C3%BCcher.example.test"),
        ("faß.example.test", "xn--fa-hia.example.test"),
        ("xn--fa-hia.example.test", "faß.example.test"),
        ("orbis%2eexample.test", "orbis.example.test"),
        ("0x8080808", "8.8.8.8"),
    ],
)
def test_equivalent_internal_hostnames_cannot_publish_private_document_urls(
    client,
    owner,
    document,
    canonical_host,
    url_host,
):
    client.app.state.settings.user_web_base_url = f"https://{canonical_host}/"
    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    save_content(
        client,
        owner,
        document["id"],
        _linked_content(
            f"https://{url_host}/documents/{document['id']}",
            "v2",
        ),
    )
    for method, suffix in ((client.get, "preview"), (client.post, "publish")):
        response = method(f"/sites/{site['id']}/{suffix}", headers=owner)
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "SITE_CONTENT_UNSAFE"
    public = client.get("/public/sites/handbook")
    assert public.json()["data"] == original
    assert document["id"] not in public.text


@pytest.mark.parametrize(
    "host",
    [
        "0x7f.0.0.1",
        "%31%32%37.0.0.1",
        "127.1",
        "127.0.1",
        "0x7f000001",
        "2130706433",
        "0177.0.0.1",
        "0x7f.1",
        "0x7f.0.01",
        "127.0x0.0.1",
        "0xa.0.0.1",
        "0xc0.0250.1.1",
        "１２７.０.０.１",
        "127。0。0。1",
        "127.0.0.1.",
        "[0:0:0:0:0:0:0:1]",
        "[::ffff:127.0.0.1]",
        "[fe80::1%25eth0]",
        "0x8.8.8.8",
        "cdn%ff.example.test",
        "cdn%ZZ.example.test",
        "cdn%2fexample.test",
        "cdn%5cexample.test",
    ],
)
def test_noncanonical_ip_and_invalid_encoded_hosts_are_not_public_resources(
    client,
    owner,
    document,
    host,
):
    site = create_site(client, owner, document)
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    save_content(
        client,
        owner,
        document["id"],
        _linked_content(f"http://{host}/files/image.png", "media"),
    )
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "SITE_CONTENT_UNSAFE"
    assert client.get("/public/sites/handbook").json()["data"] == original


@pytest.mark.parametrize(
    "url",
    [
        "https://bücher.external.test/files/public.png",
        "https://xn--bcher-kva.external.test/files/public.png",
        "https://faß.external.test/files/public.png",
        "https://xn--fa-hia.external.test/files/public.png",
        "https://例子.测试/files/public.png",
        "https://cdn%2eexample.test/files/public.png?download=1&version=2",
        "https://cdn.example.test./files/public.png",
        "https://8.8.8.8/files/public.png",
        "https://[2001:4860:4860::8888]/files/public.png",
    ],
)
def test_valid_international_and_public_ip_resources_remain_publishable(
    client, owner, document, url
):
    site = create_site(client, owner, document)
    save_content(client, owner, document["id"], _linked_content(url, "media"))
    response = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert response.status_code == 200, response.text
    assert (
        response.json()["data"]["pages"][0]["blocks"]["blocks"][0]["props"]["url"]
        == url
    )
