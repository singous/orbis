from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

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
    return response.json()


def create_notebook(client: TestClient, token: str) -> dict[str, Any]:
    response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Product notes"},
    )
    assert response.status_code == 201
    return response.json()


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
    return response.json()


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
    return accepted.json()["access_token"]


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
    tree = response.json()["items"]
    assert [item["title"] for item in tree] == ["First root", "Later root"]
    assert [item["title"] for item in tree[1]["children"]] == ["Child"]


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
    second_notebook = second_notebook_response.json()
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
    assert update_response.json()["parent_id"] is None
    tree_response = client.get(
        f"/notebooks/{notebook['id']}/notes/tree",
        headers=auth_header(token),
    )
    assert [item["title"] for item in tree_response.json()["items"]] == [
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
    assert archive_response.json()["status"] == "archived"
    assert archived_tree.json()["items"] == []
    assert restore_response.status_code == 200
    assert restore_response.json()["status"] == "active"
    assert restored_tree.json()["items"][0]["children"][0]["title"] == "Child"


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
    group = group_response.json()
    notebook_response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Orbis", "group_id": group["id"]},
    )
    assert notebook_response.status_code == 201
    notebook = notebook_response.json()
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
    groups = client.get("/document-groups", headers=auth_header(token)).json()["items"]
    assert [item["name"] for item in groups] == ["默认分组"]
    notebooks = client.get(
        "/notebooks",
        headers=auth_header(token),
        params={"group_id": group["id"]},
    ).json()["items"]
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
    ).json()["items"]
    assert [item["title"] for item in restored_notebooks] == ["Orbis"]


def test_default_group_cannot_be_archived(client: TestClient) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    groups_response = client.get("/document-groups", headers=auth_header(token))
    default_group = groups_response.json()["items"][0]

    response = client.post(
        f"/document-groups/{default_group['id']}/archive",
        headers=auth_header(token),
    )

    assert response.status_code == 409
    groups = client.get("/document-groups", headers=auth_header(token)).json()["items"]
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
    assert archive_response.json()["status"] == "archived"
    assert client.get("/notebooks", headers=auth_header(token)).json()["items"] == []
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
    assert restored_tree.json()["items"][0]["title"] == "Visible note"


def test_group_and_collection_metadata_can_be_edited_and_reordered(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    first_group = client.post(
        "/document-groups",
        headers=auth_header(token),
        json={"name": "Projects", "sort_order": 10},
    ).json()
    second_group = client.post(
        "/document-groups",
        headers=auth_header(token),
        json={"name": "Archive", "sort_order": 20},
    ).json()
    notebook = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Orbis", "group_id": first_group["id"], "sort_order": 10},
    ).json()

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
    assert group_response.json()["name"] == "Active projects"
    assert group_response.json()["sort_order"] == -1
    assert notebook_response.status_code == 200
    assert notebook_response.json()["title"] == "Orbis MVP"
    assert notebook_response.json()["group_id"] == second_group["id"]
    assert notebook_response.json()["sort_order"] == -1


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
