from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.note import Note, Notebook, NoteGroup

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

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _insert_unrelated_archived_group(client: TestClient) -> str:
    group = NoteGroup(
        id=new_uuidv7(),
        tenant_id=new_uuidv7(),
        workspace_id=new_uuidv7(),
        owner_id=new_uuidv7(),
        name="Unrelated archived group",
        is_default=False,
        sort_order=0,
        status="archived",
    )
    async with client.app.state.session_factory() as session:
        session.add(group)
        await session.commit()
    return str(group.id)


async def _insert_unrelated_archived_hierarchy(
    client: TestClient,
) -> tuple[str, str, str]:
    workspace_id = new_uuidv7()
    owner_id = new_uuidv7()
    group = NoteGroup(
        id=new_uuidv7(),
        tenant_id=new_uuidv7(),
        workspace_id=workspace_id,
        owner_id=owner_id,
        name="Unrelated archived group",
        is_default=False,
        sort_order=0,
        status="archived",
    )
    notebook = Notebook(
        id=new_uuidv7(),
        tenant_id=group.tenant_id,
        workspace_id=workspace_id,
        group_id=group.id,
        owner_id=owner_id,
        title="Unrelated archived notebook",
        sort_order=0,
        status="archived",
    )
    note = Note(
        id=new_uuidv7(),
        tenant_id=group.tenant_id,
        workspace_id=workspace_id,
        owner_id=owner_id,
        notebook_id=notebook.id,
        parent_id=None,
        title="Unrelated archived note",
        sort_order=0,
        note_type="doc",
        status="archived",
    )
    async with client.app.state.session_factory() as session:
        session.add_all([group, notebook, note])
        await session.commit()
    return str(group.id), str(notebook.id), str(note.id)


def test_archived_resources_are_listed_only_when_requested(
    client: TestClient,
) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])

    archived_group = client.post(
        "/document-groups",
        headers=headers,
        json={"name": "Archived group"},
    ).json()["data"]
    archived_notebook = client.post(
        "/notebooks",
        headers=headers,
        json={"title": "Archived notebook", "group_id": archived_group["id"]},
    ).json()["data"]
    archived_note = client.post(
        "/notes",
        headers=headers,
        json={
            "title": "archive-keyword note",
            "notebook_id": archived_notebook["id"],
        },
    ).json()["data"]

    assert (
        client.post(f"/notes/{archived_note['id']}/archive", headers=headers).status_code
        == 200
    )
    assert (
        client.post(
            f"/notebooks/{archived_notebook['id']}/archive", headers=headers
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/document-groups/{archived_group['id']}/archive", headers=headers
        ).status_code
        == 200
    )

    active_groups = client.get("/document-groups", headers=headers).json()["data"]["items"]
    archived_groups = client.get(
        "/document-groups", headers=headers, params={"status": "archived"}
    ).json()["data"]["items"]
    assert archived_group["id"] not in {item["id"] for item in active_groups}
    assert [item["id"] for item in archived_groups] == [archived_group["id"]]

    active_notebooks = client.get("/notebooks", headers=headers).json()["data"]["items"]
    archived_notebooks = client.get(
        "/notebooks", headers=headers, params={"status": "archived"}
    ).json()["data"]["items"]
    assert archived_notebook["id"] not in {item["id"] for item in active_notebooks}
    assert [item["id"] for item in archived_notebooks] == [archived_notebook["id"]]

    default_search = client.get(
        "/notes", headers=headers, params={"q": "archive-keyword"}
    )
    archived_search = client.get(
        "/notes",
        headers=headers,
        params={"status": "archived", "q": "archive-keyword"},
    )
    assert default_search.json()["data"]["items"] == []
    assert [item["id"] for item in archived_search.json()["data"]["items"]] == [
        archived_note["id"]
    ]
    assert (
        client.get("/notes", headers=headers, params={"status": "deleted"}).status_code
        == 422
    )


def test_archived_document_groups_remain_scoped_to_the_current_workspace(
    client: TestClient,
) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    unrelated_group_id = asyncio.run(_insert_unrelated_archived_group(client))

    archived_groups = client.get(
        "/document-groups", headers=headers, params={"status": "archived"}
    ).json()["data"]["items"]

    assert unrelated_group_id not in {item["id"] for item in archived_groups}


def test_archived_restore_targets_remain_scoped_to_the_current_workspace(
    client: TestClient,
) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    group_id, notebook_id, note_id = asyncio.run(
        _insert_unrelated_archived_hierarchy(client)
    )

    responses = [
        client.post(f"/document-groups/{group_id}/restore", headers=headers),
        client.post(f"/notebooks/{notebook_id}/restore", headers=headers),
        client.post(f"/notes/{note_id}/restore", headers=headers),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404]
    assert group_id not in {
        item["id"]
        for item in client.get(
            "/document-groups", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert notebook_id not in {
        item["id"]
        for item in client.get(
            "/notebooks", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert note_id not in {
        item["id"]
        for item in client.get(
            "/notes", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }


def test_restore_requires_active_parent_resources(client: TestClient) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    group = client.post(
        "/document-groups", headers=headers, json={"name": "Archived group"}
    ).json()["data"]
    notebook = client.post(
        "/notebooks",
        headers=headers,
        json={"title": "Archived notebook", "group_id": group["id"]},
    ).json()["data"]
    note = client.post(
        "/notes",
        headers=headers,
        json={"title": "Archived note", "notebook_id": notebook["id"]},
    ).json()["data"]

    for path in (
        f"/notes/{note['id']}/archive",
        f"/notebooks/{notebook['id']}/archive",
        f"/document-groups/{group['id']}/archive",
    ):
        assert client.post(path, headers=headers).status_code == 200

    notebook_restore = client.post(
        f"/notebooks/{notebook['id']}/restore", headers=headers
    )
    note_restore = client.post(f"/notes/{note['id']}/restore", headers=headers)

    assert notebook_restore.status_code == 409
    assert note_restore.status_code == 409
    assert notebook["id"] in {
        item["id"]
        for item in client.get(
            "/notebooks", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert note["id"] in {
        item["id"]
        for item in client.get(
            "/notes", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert client.post(
        f"/document-groups/{group['id']}/restore", headers=headers
    ).status_code == 200
    assert client.post(
        f"/notes/{note['id']}/restore", headers=headers
    ).status_code == 409
    assert client.post(
        f"/notebooks/{notebook['id']}/restore", headers=headers
    ).status_code == 200
    assert client.post(f"/notes/{note['id']}/restore", headers=headers).status_code == 200


def test_note_restore_requires_an_active_notebook_group(client: TestClient) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    group = client.post(
        "/document-groups", headers=headers, json={"name": "Archived group"}
    ).json()["data"]
    notebook = client.post(
        "/notebooks",
        headers=headers,
        json={"title": "Active notebook", "group_id": group["id"]},
    ).json()["data"]
    note = client.post(
        "/notes",
        headers=headers,
        json={"title": "Archived note", "notebook_id": notebook["id"]},
    ).json()["data"]
    assert client.post(f"/notes/{note['id']}/archive", headers=headers).status_code == 200
    assert client.post(
        f"/document-groups/{group['id']}/archive", headers=headers
    ).status_code == 200
    assert client.get("/notebooks", headers=headers).json()["data"]["items"] == []
    hidden_active_notebooks = client.get(
        "/notebooks",
        headers=headers,
        params={"include_inactive_parents": True},
    ).json()["data"]["items"]
    assert [item["id"] for item in hidden_active_notebooks] == [notebook["id"]]

    restore_response = client.post(f"/notes/{note['id']}/restore", headers=headers)

    assert restore_response.status_code == 409
    assert note["id"] in {
        item["id"]
        for item in client.get(
            "/notes", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert client.post(
        f"/document-groups/{group['id']}/restore", headers=headers
    ).status_code == 200
    assert client.post(f"/notes/{note['id']}/restore", headers=headers).status_code == 200
    tree = client.get(
        f"/notebooks/{notebook['id']}/notes/tree", headers=headers
    ).json()["data"]["items"]
    assert [item["id"] for item in tree] == [note["id"]]


def test_child_note_restore_requires_an_active_parent_note(client: TestClient) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    notebook = client.post(
        "/notebooks", headers=headers, json={"title": "Active notebook"}
    ).json()["data"]
    parent = client.post(
        "/notes",
        headers=headers,
        json={"title": "Parent note", "notebook_id": notebook["id"]},
    ).json()["data"]
    child = client.post(
        "/notes",
        headers=headers,
        json={
            "title": "Child note",
            "notebook_id": notebook["id"],
            "parent_id": parent["id"],
        },
    ).json()["data"]
    assert client.post(
        f"/notes/{parent['id']}/archive", headers=headers
    ).status_code == 200
    assert client.post(
        f"/notes/{child['id']}/archive", headers=headers
    ).status_code == 200

    restore_response = client.post(
        f"/notes/{child['id']}/restore", headers=headers
    )

    assert restore_response.status_code == 409
    assert child["id"] in {
        item["id"]
        for item in client.get(
            "/notes", headers=headers, params={"status": "archived"}
        ).json()["data"]["items"]
    }
    assert client.post(
        f"/notes/{parent['id']}/restore", headers=headers
    ).status_code == 200
    assert client.post(
        f"/notes/{child['id']}/restore", headers=headers
    ).status_code == 200
    tree = client.get(
        f"/notebooks/{notebook['id']}/notes/tree", headers=headers
    ).json()["data"]["items"]
    assert [item["id"] for item in tree] == [parent["id"]]
    assert [item["id"] for item in tree[0]["children"]] == [child["id"]]


def test_note_restore_requires_every_note_ancestor_to_be_active(
    client: TestClient,
) -> None:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    headers = auth_header(setup_response.json()["data"]["access_token"])
    notebook = client.post(
        "/notebooks", headers=headers, json={"title": "Active notebook"}
    ).json()["data"]
    grandparent = client.post(
        "/notes",
        headers=headers,
        json={"title": "Grandparent note", "notebook_id": notebook["id"]},
    ).json()["data"]
    parent = client.post(
        "/notes",
        headers=headers,
        json={
            "title": "Active parent note",
            "notebook_id": notebook["id"],
            "parent_id": grandparent["id"],
        },
    ).json()["data"]
    child = client.post(
        "/notes",
        headers=headers,
        json={
            "title": "Archived child note",
            "notebook_id": notebook["id"],
            "parent_id": parent["id"],
        },
    ).json()["data"]
    assert client.post(
        f"/notes/{grandparent['id']}/archive", headers=headers
    ).status_code == 200
    assert client.post(
        f"/notes/{child['id']}/archive", headers=headers
    ).status_code == 200

    restore_response = client.post(
        f"/notes/{child['id']}/restore", headers=headers
    )

    assert restore_response.status_code == 409
    assert client.post(
        f"/notes/{grandparent['id']}/restore", headers=headers
    ).status_code == 200
    assert client.post(
        f"/notes/{child['id']}/restore", headers=headers
    ).status_code == 200
