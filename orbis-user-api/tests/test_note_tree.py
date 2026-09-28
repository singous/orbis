from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from orbis_user_api.application import notes as notes_application
from orbis_user_api.schemas.note import NoteOrderRequest
from orbis_user_api.services.exceptions import NoteOrderConflict

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv("ORBIS_MAIL_TRANSPORT", "outbox")
    monkeypatch.setenv("ORBIS_MAIL_OUTBOX_DIR", str(tmp_path / "mail-outbox"))

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def setup_owner(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201
    return response.json()["data"]


def create_notebook(client: TestClient, token: str) -> dict[str, Any]:
    response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Product notes"},
    )
    assert response.status_code == 201
    return response.json()["data"]


def create_note(
    client: TestClient,
    token: str,
    notebook_id: str,
    *,
    title: str,
    parent_id: str | None,
    sort_order: int,
) -> dict[str, Any]:
    response = client.post(
        "/notes",
        headers=auth_header(token),
        json={
            "notebook_id": notebook_id,
            "title": title,
            "parent_id": parent_id,
            "sort_order": sort_order,
        },
    )
    assert response.status_code == 201
    return response.json()["data"]


def invite_normal_member(client: TestClient, owner_token: str) -> str:
    response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner_token),
        json={"email": "reader@example.com", "role": "normal"},
    )
    assert response.status_code == 201
    outbox_dir = Path(client.app.state.settings.mail_outbox_dir)
    message = json.loads(max(outbox_dir.glob("*.json")).read_text(encoding="utf-8"))
    accepted = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": "Reader",
        },
    )
    assert accepted.status_code == 201
    return accepted.json()["data"]["access_token"]


def test_note_tree_supports_nested_notes_with_stable_sibling_order(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    later_root = create_note(
        client,
        token,
        notebook["id"],
        title="Later root",
        parent_id=None,
        sort_order=10,
    )
    create_note(
        client,
        token,
        notebook["id"],
        title="Child",
        parent_id=later_root["id"],
        sort_order=0,
    )
    create_note(
        client,
        token,
        notebook["id"],
        title="First root",
        parent_id=None,
        sort_order=0,
    )

    response = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )

    assert response.status_code == 200
    tree = response.json()["data"]["items"]
    assert [item["title"] for item in tree] == ["First root", "Later root"]
    assert [item["title"] for item in tree[1]["children"]] == ["Child"]


def test_reorder_notes_persists_complete_sibling_order_without_moving_children(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    roots = [
        create_note(client, token, notebook["id"], title=title, parent_id=None, sort_order=index)
        for index, title in enumerate(("First", "Second", "Third"))
    ]
    children = [
        create_note(client, token, notebook["id"], title=title, parent_id=roots[0]["id"], sort_order=index)
        for index, title in enumerate(("One", "Two"))
    ]
    tree_url = f"/notebooks/{notebook['id']}/notes/tree"
    reorder_url = f"/notebooks/{notebook['id']}/notes/order"

    reordered = client.put(
        reorder_url,
        headers=auth_header(token),
        json={
            "parent_id": None,
            "expected_note_ids": [note["id"] for note in roots],
            "note_ids": [roots[2]["id"], roots[0]["id"], roots[1]["id"]],
        },
    )
    assert reordered.status_code == 200
    assert [note["title"] for note in reordered.json()["data"]["items"]] == [
        "Third", "First", "Second"
    ]
    saved = client.get(tree_url, headers=auth_header(token)).json()["data"]["items"]
    assert [note["id"] for note in saved] == [roots[2]["id"], roots[0]["id"], roots[1]["id"]]
    assert [note["sort_order"] for note in saved] == [0, 1, 2]
    assert [note["id"] for note in saved[1]["children"]] == [
        children[0]["id"], children[1]["id"]
    ]

    child_reorder = client.put(
        reorder_url,
        headers=auth_header(token),
        json={
            "parent_id": roots[0]["id"],
            "expected_note_ids": [child["id"] for child in children],
            "note_ids": [children[1]["id"], children[0]["id"]],
        },
    )
    assert child_reorder.status_code == 200
    assert [note["id"] for note in child_reorder.json()["data"]["items"][1]["children"]] == [
        children[1]["id"], children[0]["id"]
    ]


def test_reorder_rejects_stale_or_cross_parent_lists_without_partial_write(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    first = create_note(client, token, notebook["id"], title="First", parent_id=None, sort_order=0)
    second = create_note(client, token, notebook["id"], title="Second", parent_id=None, sort_order=1)
    child = create_note(client, token, notebook["id"], title="Child", parent_id=first["id"], sort_order=0)
    url = f"/notebooks/{notebook['id']}/notes/order"
    initial = [first["id"], second["id"]]

    for requested in (initial[:1], [first["id"], first["id"]], [second["id"], child["id"]]):
        rejected = client.put(
            url,
            headers=auth_header(token),
            json={"parent_id": None, "expected_note_ids": initial, "note_ids": requested},
        )
        assert rejected.status_code == 409

    valid = client.put(
        url,
        headers=auth_header(token),
        json={"parent_id": None, "expected_note_ids": initial, "note_ids": initial[::-1]},
    )
    assert valid.status_code == 200
    stale = client.put(
        url,
        headers=auth_header(token),
        json={"parent_id": None, "expected_note_ids": initial, "note_ids": initial},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "NOTE_ORDER_CONFLICT"

    saved = client.get(
        f"/notebooks/{notebook['id']}/notes/tree", headers=auth_header(token)
    ).json()["data"]["items"]
    assert [note["id"] for note in saved] == initial[::-1]
    assert [note["id"] for note in saved[1]["children"]] == [child["id"]]

    reader_token = invite_normal_member(client, token)
    forbidden = client.put(
        url,
        headers=auth_header(reader_token),
        json={"parent_id": None, "expected_note_ids": initial[::-1], "note_ids": initial},
    )
    assert forbidden.status_code == 403


def test_reorder_rechecks_sort_values_after_waiting_for_row_locks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notebook_id = uuid4()
    workspace_id = uuid4()
    first_id, second_id = uuid4(), uuid4()
    # The database can return rows in the order calculated before a lock wait,
    # while the returned sort values already reflect the other transaction.
    stale_query_order = [
        SimpleNamespace(id=first_id, sort_order=1, created_at_ms=10),
        SimpleNamespace(id=second_id, sort_order=0, created_at_ms=20),
    ]
    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value = iter(stale_query_order)
    session.execute.return_value = result
    monkeypatch.setattr(
        notes_application,
        "get_current_workspace",
        AsyncMock(return_value=(SimpleNamespace(id=workspace_id), None)),
    )
    monkeypatch.setattr(notes_application, "_get_active_notebook", AsyncMock())
    monkeypatch.setattr(notes_application, "get_note_tree", AsyncMock(return_value=[]))

    with pytest.raises(NoteOrderConflict):
        asyncio.run(notes_application.reorder_notes(
            notebook_id,
            NoteOrderRequest(
                parent_id=None,
                expected_note_ids=[first_id, second_id],
                note_ids=[second_id, first_id],
            ),
            SimpleNamespace(),
            session,
        ))
    session.commit.assert_not_awaited()


def test_note_parent_must_belong_to_same_collection(client: TestClient) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    first_notebook = create_notebook(client, token)
    second_notebook_response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Second collection"},
    )
    assert second_notebook_response.status_code == 201
    second_notebook = second_notebook_response.json()["data"]
    parent = create_note(
        client,
        token,
        first_notebook["id"],
        title="Parent",
        parent_id=None,
        sort_order=0,
    )

    response = client.post(
        "/notes",
        headers=auth_header(token),
        json={
            "notebook_id": second_notebook["id"],
            "title": "Invalid child",
            "parent_id": parent["id"],
            "sort_order": 0,
        },
    )

    assert response.status_code == 409


def test_note_can_be_reparented_and_reordered_within_collection(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    root = create_note(
        client,
        token,
        notebook["id"],
        title="Root",
        parent_id=None,
        sort_order=0,
    )
    child = create_note(
        client,
        token,
        notebook["id"],
        title="Child",
        parent_id=root["id"],
        sort_order=0,
    )

    update_response = client.patch(
        f"/notes/{child['id']}",
        headers=auth_header(token),
        json={"parent_id": None, "sort_order": -1},
    )

    assert update_response.status_code == 200
    assert update_response.json()["data"]["parent_id"] is None
    tree_response = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )
    assert [item["title"] for item in tree_response.json()["data"]["items"]] == [
        "Child",
        "Root",
    ]


def test_note_cannot_be_reparented_below_its_descendant(client: TestClient) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    root = create_note(
        client,
        token,
        notebook["id"],
        title="Root",
        parent_id=None,
        sort_order=0,
    )
    child = create_note(
        client,
        token,
        notebook["id"],
        title="Child",
        parent_id=root["id"],
        sort_order=0,
    )

    response = client.patch(
        f"/notes/{root['id']}",
        headers=auth_header(token),
        json={"parent_id": child["id"]},
    )

    assert response.status_code == 409


def test_archiving_parent_hides_subtree_and_restore_reveals_it(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    root = create_note(
        client,
        token,
        notebook["id"],
        title="Root",
        parent_id=None,
        sort_order=0,
    )
    create_note(
        client,
        token,
        notebook["id"],
        title="Child",
        parent_id=root["id"],
        sort_order=0,
    )

    archive_response = client.post(
        f"/notes/{root['id']}/archive",
        headers=auth_header(token),
    )
    archived_tree = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )
    restore_response = client.post(
        f"/notes/{root['id']}/restore",
        headers=auth_header(token),
    )
    restored_tree = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )

    assert archive_response.status_code == 200
    assert archive_response.json()["data"]["status"] == "archived"
    assert archived_tree.json()["data"]["items"] == []
    assert restore_response.status_code == 200
    assert restore_response.json()["data"]["status"] == "active"
    assert restored_tree.json()["data"]["items"][0]["children"][0]["title"] == "Child"


def test_archiving_group_hides_collections_and_notes_until_restore(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    group_response = client.post(
        "/document-groups",
        headers=auth_header(token),
        json={"name": "Projects", "sort_order": 1},
    )
    assert group_response.status_code == 201
    group = group_response.json()["data"]
    notebook_response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Orbis", "group_id": group["id"]},
    )
    assert notebook_response.status_code == 201
    notebook = notebook_response.json()["data"]
    create_note(
        client,
        token,
        notebook["id"],
        title="Roadmap",
        parent_id=None,
        sort_order=0,
    )

    archive_response = client.post(
        f"/document-groups/{group['id']}/archive",
        headers=auth_header(token),
    )

    assert archive_response.status_code == 200
    groups = client.get("/document-groups", headers=auth_header(token)).json()["data"]["items"]
    assert [item["name"] for item in groups] == ["默认分组"]
    notebooks = client.get(
        "/notebooks",
        headers=auth_header(token),
        params={"group_id": group["id"]},
    ).json()["data"]["items"]
    assert notebooks == []
    assert (
        client.get(
            f"/notebooks/{notebook['id']}/notes/tree",
            headers=auth_header(token),
        ).status_code
        == 404
    )

    restore_response = client.post(
        f"/document-groups/{group['id']}/restore",
        headers=auth_header(token),
    )
    assert restore_response.status_code == 200
    restored_notebooks = client.get(
        "/notebooks",
        headers=auth_header(token),
        params={"group_id": group["id"]},
    ).json()["data"]["items"]
    assert [item["title"] for item in restored_notebooks] == ["Orbis"]


def test_default_group_cannot_be_archived(client: TestClient) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    groups_response = client.get("/document-groups", headers=auth_header(token))
    default_group = groups_response.json()["data"]["items"][0]

    response = client.post(
        f"/document-groups/{default_group['id']}/archive",
        headers=auth_header(token),
    )

    assert response.status_code == 409
    groups = client.get("/document-groups", headers=auth_header(token)).json()["data"]["items"]
    assert [item["name"] for item in groups] == ["默认分组"]


def test_archiving_collection_hides_note_tree_until_restore(client: TestClient) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    notebook = create_notebook(client, token)
    create_note(
        client,
        token,
        notebook["id"],
        title="Visible note",
        parent_id=None,
        sort_order=0,
    )

    archive_response = client.post(
        f"/notebooks/{notebook['id']}/archive",
        headers=auth_header(token),
    )

    assert archive_response.status_code == 200
    assert archive_response.json()["data"]["status"] == "archived"
    assert client.get("/notebooks", headers=auth_header(token)).json()["data"]["items"] == []
    assert (
        client.get(
            f"/notebooks/{notebook['id']}/notes/tree",
            headers=auth_header(token),
        ).status_code
        == 404
    )

    restore_response = client.post(
        f"/notebooks/{notebook['id']}/restore",
        headers=auth_header(token),
    )
    assert restore_response.status_code == 200
    restored_tree = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )
    assert restored_tree.json()["data"]["items"][0]["title"] == "Visible note"


def test_group_and_collection_metadata_can_be_edited_and_reordered(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    first_group = client.post(
        "/document-groups",
        headers=auth_header(token),
        json={"name": "Projects", "sort_order": 10},
    ).json()["data"]
    second_group = client.post(
        "/document-groups",
        headers=auth_header(token),
        json={"name": "Archive", "sort_order": 20},
    ).json()["data"]
    notebook = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Orbis", "group_id": first_group["id"], "sort_order": 10},
    ).json()["data"]

    group_response = client.patch(
        f"/document-groups/{first_group['id']}",
        headers=auth_header(token),
        json={"name": "Active projects", "sort_order": -1},
    )
    notebook_response = client.patch(
        f"/notebooks/{notebook['id']}",
        headers=auth_header(token),
        json={"title": "Orbis MVP", "group_id": second_group["id"], "sort_order": -1},
    )

    assert group_response.status_code == 200
    assert group_response.json()["data"]["name"] == "Active projects"
    assert group_response.json()["data"]["sort_order"] == -1
    assert notebook_response.status_code == 200
    assert notebook_response.json()["data"]["title"] == "Orbis MVP"
    assert notebook_response.json()["data"]["group_id"] == second_group["id"]
    assert notebook_response.json()["data"]["sort_order"] == -1


def test_normal_member_can_read_notes_but_cannot_mutate_note_workspace(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    owner_token = owner["access_token"]
    notebook = create_notebook(client, owner_token)
    note = create_note(
        client,
        owner_token,
        notebook["id"],
        title="Shared note",
        parent_id=None,
        sort_order=0,
    )
    normal_token = invite_normal_member(client, owner_token)

    assert (
        client.get("/document-groups", headers=auth_header(normal_token)).status_code
        == 200
    )
    assert (
        client.get("/notebooks", headers=auth_header(normal_token)).status_code == 200
    )
    assert (
        client.get(
            f"/notebooks/{notebook['id']}/notes/tree", headers=auth_header(normal_token)
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"/notes/{note['id']}/content", headers=auth_header(normal_token)
        ).status_code
        == 200
    )

    forbidden_requests = [
        client.post(
            "/document-groups",
            headers=auth_header(normal_token),
            json={"name": "Forbidden"},
        ),
        client.post(
            "/notebooks",
            headers=auth_header(normal_token),
            json={"title": "Forbidden"},
        ),
        client.post(
            "/notes",
            headers=auth_header(normal_token),
            json={"notebook_id": notebook["id"], "title": "Forbidden"},
        ),
        client.patch(
            f"/notes/{note['id']}",
            headers=auth_header(normal_token),
            json={"title": "Forbidden"},
        ),
        client.post(f"/notes/{note['id']}/archive", headers=auth_header(normal_token)),
        client.put(
            f"/notes/{note['id']}/content",
            headers=auth_header(normal_token),
            json={
                "expected_version": 1,
                "blocks": {
                    "schema_version": 1,
                    "editor": "tiptap",
                    "doc": {"type": "doc", "content": []},
                },
            },
        ),
    ]
    assert [response.status_code for response in forbidden_requests] == [403] * 6
