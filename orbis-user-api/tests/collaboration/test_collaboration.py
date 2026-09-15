from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from orbis_user_api.models.note import NoteContent

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    for key, value in {
        "ORBIS_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        "ORBIS_STORAGE_DIR": str(tmp_path / "storage"),
        "ORBIS_AUTO_CREATE_TABLES": "true",
        "ORBIS_ACCESS_TOKEN_SECRET": "test-access-secret-with-at-least-32-bytes",
        "ORBIS_REFRESH_TOKEN_SECRET": "test-refresh-secret-with-at-least-32-bytes",
        "ORBIS_MAIL_TRANSPORT": "outbox",
        "ORBIS_MAIL_OUTBOX_DIR": str(tmp_path / "outbox"),
    }.items():
        monkeypatch.setenv(key, value)
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def setup(client: TestClient) -> tuple[dict[str, str], dict[str, Any], dict[str, Any]]:
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201
    owner = response.json()["data"]
    headers = {"Authorization": f"Bearer {owner['access_token']}"}
    notebook = client.post(
        "/notebooks", headers=headers, json={"title": "Notes"}
    ).json()["data"]
    note = create_note(client, headers, notebook["id"])
    return headers, notebook, note


def create_note(
    client: TestClient, headers: dict[str, str], notebook_id: str, **kwargs
):
    response = client.post(
        "/notes",
        headers=headers,
        json={
            "notebook_id": notebook_id,
            "title": "Document",
            **kwargs,
        },
    )
    assert response.status_code == 201
    return response.json()["data"]


def member(client: TestClient, headers: dict[str, str], tmp_path: Path, role="normal"):
    response = client.post(
        "/workspace/invitations",
        headers=headers,
        json={
            "email": f"{role}@example.com",
            "role": role,
        },
    )
    assert response.status_code == 201
    message = json.loads(max((tmp_path / "outbox").glob("*.json")).read_text())
    response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": role.title(),
        },
    )
    assert response.status_code == 201
    data = response.json()["data"]
    return {"Authorization": f"Bearer {data['access_token']}"}, data


def blocks(text: str):
    return {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]}
            ],
        },
    }


def save(client, headers, note_id, version, text):
    return client.put(
        f"/notes/{note_id}/content",
        headers=headers,
        json={
            "expected_version": version,
            "blocks": blocks(text),
        },
    )


def comment(client, headers, note_id, body="Please clarify", **kwargs):
    response = client.post(
        f"/notes/{note_id}/comments", headers=headers, json={"body": body, **kwargs}
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def revisions(client, headers, note_id, **params):
    response = client.get(f"/notes/{note_id}/revisions", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_normal_member_comments_replies_edits_and_reads_paginated_comments(
    client, tmp_path
):
    owner, _, note = setup(client)
    reader, reader_data = member(client, owner, tmp_path)
    root = comment(client, reader, note["id"], "  Please clarify  ")
    assert root["body"] == "Please clarify"
    assert root["author_name"] == "Normal"
    assert root["author_id"] == reader_data["user"]["id"]
    assert UUID(root["id"]).version == 7
    reply = comment(client, owner, note["id"], "Explanation", parent_id=root["id"])
    assert reply["parent_id"] == root["id"]
    url = f"/notes/{note['id']}/comments/{root['id']}"
    assert (
        client.patch(url, headers=reader, json={"body": "Clarified"}).json()["data"][
            "body"
        ]
        == "Clarified"
    )
    page = client.get(
        f"/notes/{note['id']}/comments?page_size=1", headers=reader
    ).json()["data"]
    assert page["items"][0]["id"] == root["id"]
    assert page["pagination"]["total"] == 2
    assert page["pagination"]["has_next"] is True
    assert save(client, reader, note["id"], 1, "Forbidden").status_code == 403


def test_author_or_manager_resolves_but_only_author_edits_body(client, tmp_path):
    owner, _, note = setup(client)
    reader, _ = member(client, owner, tmp_path)
    editor, _ = member(client, owner, tmp_path, "editor")
    item = comment(client, reader, note["id"])
    url = f"/notes/{note['id']}/comments/{item['id']}"
    for actor in (owner, editor):
        assert (
            client.patch(
                url, headers=actor, json={"body": "Changed", "is_resolved": True}
            ).status_code
            == 403
        )
        assert (
            client.patch(url, headers=actor, json={"is_resolved": True}).json()["data"][
                "is_resolved"
            ]
            is True
        )
    assert (
        client.patch(url, headers=reader, json={"is_resolved": False}).json()["data"][
            "is_resolved"
        ]
        is False
    )
    other = comment(client, owner, note["id"])
    assert (
        client.patch(
            f"/notes/{note['id']}/comments/{other['id']}",
            headers=reader,
            json={"is_resolved": True},
        ).status_code
        == 403
    )
    assert (
        client.get(f"/notes/{note['id']}/comments", headers=owner).json()["data"][
            "items"
        ][0]["body"]
        == item["body"]
    )


def test_comment_validation_and_parent_must_belong_to_note(client):
    owner, notebook, note = setup(client)
    item = comment(client, owner, note["id"])
    other = create_note(client, owner, notebook["id"])
    assert (
        client.post(
            f"/notes/{other['id']}/comments",
            headers=owner,
            json={"body": "Reply", "parent_id": item["id"]},
        ).status_code
        == 404
    )
    for body in ("", "   ", "a" * 10001):
        assert (
            client.post(
                f"/notes/{note['id']}/comments", headers=owner, json={"body": body}
            ).status_code
            == 422
        )
    for payload in ({}, {"body": None}, {"is_resolved": None}):
        assert (
            client.patch(
                f"/notes/{note['id']}/comments/{item['id']}",
                headers=owner,
                json=payload,
            ).status_code
            == 422
        )
    assert (
        client.patch(
            f"/notes/{other['id']}/comments/{item['id']}",
            headers=owner,
            json={"body": "Wrong note"},
        ).status_code
        == 404
    )


def test_history_preserves_original_and_immutable_saves_with_author_and_pagination(
    client,
):
    owner, _, note = setup(client)
    assert save(client, owner, note["id"], 1, "First").status_code == 200
    assert save(client, owner, note["id"], 2, "Second").status_code == 200
    history = revisions(client, owner, note["id"])
    assert [item["content_version"] for item in history["items"]] == [3, 2, 1]
    assert history["items"][0]["author_name"] == "Owner"
    assert "blocks" not in history["items"][0]
    detail = client.get(
        f"/notes/{note['id']}/revisions/{history['items'][1]['id']}", headers=owner
    ).json()["data"]
    assert detail["plain_text"] == "First"
    assert detail["blocks"] == blocks("First")
    original = client.get(
        f"/notes/{note['id']}/revisions/{history['items'][2]['id']}", headers=owner
    ).json()["data"]
    assert original["plain_text"] == ""
    second_page = revisions(client, owner, note["id"], page=2, page_size=2)
    assert [item["content_version"] for item in second_page["items"]] == [1]
    assert second_page["pagination"]["total"] == 3


def test_restore_creates_new_revision_and_preserves_pre_restore_draft(client, tmp_path):
    owner, _, note = setup(client)
    reader, _ = member(client, owner, tmp_path)
    assert save(client, owner, note["id"], 1, "First").status_code == 200
    first = revisions(client, reader, note["id"])["items"][0]
    assert save(client, owner, note["id"], 2, "Private draft").status_code == 200
    url = f"/notes/{note['id']}/revisions/{first['id']}/restore"
    assert (
        client.post(url, headers=reader, json={"expected_version": 3}).status_code
        == 403
    )
    restored = client.post(url, headers=owner, json={"expected_version": 3})
    assert restored.status_code == 200
    assert restored.json()["data"]["content_version"] == 4
    assert restored.json()["data"]["plain_text"] == "First"
    history = revisions(client, reader, note["id"])["items"]
    assert [item["content_version"] for item in history] == [4, 3, 2, 1]
    draft = client.get(
        f"/notes/{note['id']}/revisions/{history[1]['id']}", headers=reader
    ).json()["data"]
    assert draft["plain_text"] == "Private draft"
    stale = client.post(url, headers=owner, json={"expected_version": 3})
    assert stale.status_code == 409
    assert stale.json()["code"] == "NOTE_VERSION_CONFLICT"
    assert revisions(client, owner, note["id"])["pagination"]["total"] == 4


def test_first_save_retains_legacy_imported_content(client):
    owner, notebook, _ = setup(client)
    imported = client.post(
        "/notes/import/markdown",
        headers=owner,
        json={
            "notebook_id": notebook["id"],
            "title": "Imported",
            "markdown": "Original import",
        },
    ).json()["data"]
    assert save(client, owner, imported["id"], 1, "Changed").status_code == 200
    original = revisions(client, owner, imported["id"])["items"][-1]
    assert (
        client.get(
            f"/notes/{imported['id']}/revisions/{original['id']}", headers=owner
        ).json()["data"]["plain_text"]
        == "Original import"
    )


def test_conflicting_save_does_not_change_content_or_history(client):
    owner, _, note = setup(client)
    assert save(client, owner, note["id"], 1, "Accepted").status_code == 200
    before = revisions(client, owner, note["id"])
    assert save(client, owner, note["id"], 1, "Rejected").status_code == 409
    assert revisions(client, owner, note["id"]) == before
    assert (
        client.get(f"/notes/{note['id']}/content", headers=owner).json()["data"][
            "plain_text"
        ]
        == "Accepted"
    )


def test_concurrent_same_version_saves_have_one_winner_and_no_orphan_history(
    client, monkeypatch
):
    owner, _, note = setup(client)
    original_execute = AsyncSession.execute
    readers = 0
    barrier = asyncio.Event()

    async def read_together(self, statement, *args, **kwargs):
        nonlocal readers
        result = await original_execute(self, statement, *args, **kwargs)
        if (
            isinstance(statement, Select)
            and statement.column_descriptions[0].get("entity") is NoteContent
        ):
            readers += 1
            if readers == 2:
                barrier.set()
            if readers <= 2:
                await asyncio.wait_for(barrier.wait(), timeout=5)
        return result

    monkeypatch.setattr(AsyncSession, "execute", read_together)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda text: save(client, owner, note["id"], 1, text),
                ["Writer A", "Writer B"],
            )
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    accepted = next(
        response.json()["data"] for response in responses if response.status_code == 200
    )
    current = client.get(f"/notes/{note['id']}/content", headers=owner).json()["data"]
    assert current["plain_text"] == accepted["plain_text"]
    assert current["content_version"] == 2
    assert [
        item["content_version"]
        for item in revisions(client, owner, note["id"])["items"]
    ] == [2, 1]


@pytest.mark.parametrize("ancestor", ["note", "notebook", "group"])
def test_collaboration_hides_archived_ancestors(client, ancestor):
    owner, notebook, parent = setup(client)
    note = create_note(client, owner, notebook["id"], parent_id=parent["id"])
    item = comment(client, owner, note["id"])
    assert save(client, owner, note["id"], 1, "First").status_code == 200
    revision = revisions(client, owner, note["id"])["items"][0]
    if ancestor == "note":
        archive_url = f"/notes/{parent['id']}/archive"
    elif ancestor == "notebook":
        archive_url = f"/notebooks/{notebook['id']}/archive"
    else:
        group = client.post(
            "/document-groups", headers=owner, json={"name": "Archive group"}
        ).json()["data"]
        assert (
            client.patch(
                f"/notebooks/{notebook['id']}",
                headers=owner,
                json={"group_id": group["id"]},
            ).status_code
            == 200
        )
        archive_url = f"/document-groups/{group['id']}/archive"
    assert client.post(archive_url, headers=owner).status_code == 200
    assert client.get(f"/notes/{note['id']}/comments", headers=owner).status_code == 404
    assert (
        client.post(
            f"/notes/{note['id']}/comments", headers=owner, json={"body": "No"}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/notes/{note['id']}/comments/{item['id']}",
            headers=owner,
            json={"body": "No"},
        ).status_code
        == 404
    )
    assert (
        client.get(f"/notes/{note['id']}/revisions", headers=owner).status_code == 404
    )
    assert (
        client.get(
            f"/notes/{note['id']}/revisions/{revision['id']}", headers=owner
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/notes/{note['id']}/revisions/{revision['id']}/restore",
            headers=owner,
            json={"expected_version": 2},
        ).status_code
        == 404
    )


def test_other_workspace_and_removed_member_cannot_access_collaboration(
    client, tmp_path
):
    owner, notebook, note = setup(client)
    reader, data = member(client, owner, tmp_path)
    item = comment(client, reader, note["id"])
    assert save(client, owner, note["id"], 1, "First").status_code == 200
    revision = revisions(client, owner, note["id"])["items"][0]

    async def move_note_to_foreign_workspace():
        from orbis_user_api.core.ids import new_uuidv7
        from orbis_user_api.models.note import Note

        async with client.app.state.session_factory() as session:
            record = await session.get(Note, UUID(note["id"]))
            record.workspace_id = new_uuidv7()
            await session.commit()

    client.portal.call(move_note_to_foreign_workspace)
    assert (
        client.get(f"/notes/{note['id']}/comments", headers=reader).status_code == 404
    )
    assert (
        client.patch(
            f"/notes/{note['id']}/comments/{item['id']}",
            headers=reader,
            json={"body": "No"},
        ).status_code
        == 404
    )
    assert (
        client.get(f"/notes/{note['id']}/revisions", headers=owner).status_code == 404
    )
    assert (
        client.get(
            f"/notes/{note['id']}/revisions/{revision['id']}", headers=owner
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/notes/{note['id']}/revisions/{revision['id']}/restore",
            headers=owner,
            json={"expected_version": 2},
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/workspace/members/{data['membership']['id']}", headers=owner
        ).status_code
        == 200
    )
    active = create_note(client, owner, notebook["id"])
    assert (
        client.get(f"/notes/{active['id']}/comments", headers=reader).status_code == 403
    )
    assert (
        client.post(
            f"/notes/{active['id']}/comments", headers=reader, json={"body": "No"}
        ).status_code
        == 403
    )
    assert client.get(f"/notes/{active['id']}/comments").status_code == 401


def test_revision_write_failure_rolls_back_saved_content_and_all_history(
    client, monkeypatch
):
    owner, _, note = setup(client)
    from orbis_user_api.application import notes

    original_record = notes.record_content_revisions

    async def fail_after_recording(*args, **kwargs):
        await original_record(*args, **kwargs)
        await kwargs["session"].flush()
        raise RuntimeError("Simulated revision storage failure")

    monkeypatch.setattr(notes, "record_content_revisions", fail_after_recording)
    with pytest.raises(RuntimeError, match="Simulated revision storage failure"):
        save(client, owner, note["id"], 1, "Must roll back")
    current = client.get(f"/notes/{note['id']}/content", headers=owner).json()["data"]
    assert current["content_version"] == 1
    assert current["plain_text"] == ""
    assert revisions(client, owner, note["id"])["pagination"]["total"] == 0


def test_revision_ids_are_scoped_to_their_note_and_comments_hide_archived_note(client):
    owner, notebook, note = setup(client)
    other = create_note(client, owner, notebook["id"])
    assert save(client, owner, note["id"], 1, "Private document").status_code == 200
    revision = revisions(client, owner, note["id"])["items"][0]
    assert (
        client.get(
            f"/notes/{other['id']}/revisions/{revision['id']}", headers=owner
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/notes/{other['id']}/revisions/{revision['id']}/restore",
            headers=owner,
            json={"expected_version": 1},
        ).status_code
        == 404
    )
    assert client.post(f"/notes/{note['id']}/archive", headers=owner).status_code == 200
    assert client.get(f"/notes/{note['id']}/comments", headers=owner).status_code == 404
    assert (
        client.get(f"/notes/{note['id']}/revisions", headers=owner).status_code == 404
    )


def test_first_tracked_save_keeps_legacy_version_without_inventing_an_author(client):
    owner, _, note = setup(client)

    async def seed_legacy_content():
        from sqlalchemy import select

        async with client.app.state.session_factory() as session:
            legacy = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(note["id"]))
            )
            legacy.content_version = 8
            legacy.blocks = blocks("Legacy document")
            legacy.plain_text = "Legacy document"
            await session.commit()

    client.portal.call(seed_legacy_content)
    assert save(client, owner, note["id"], 8, "New version").status_code == 200
    history = revisions(client, owner, note["id"])["items"]
    assert [item["content_version"] for item in history] == [9, 8]
    assert history[1]["author_name"] == "历史版本"
    legacy = client.get(
        f"/notes/{note['id']}/revisions/{history[1]['id']}", headers=owner
    ).json()["data"]
    assert legacy["plain_text"] == "Legacy document"
