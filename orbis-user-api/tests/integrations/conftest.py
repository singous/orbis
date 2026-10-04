from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'library.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "files"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "isolated-library-access-secret-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET",
        "isolated-library-refresh-secret-at-least-32-bytes",
    )
    monkeypatch.setenv("ORBIS_ACTION_TOKEN_SECRET", "isolated-library-action-secret-at-least-32-bytes")
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as value:
        yield value


@pytest.fixture()
def library(client):
    auth = client.post(
        "/setup",
        json={
            "email": "library@example.com",
            "password": "Library-Isolated-2026!",
            "display_name": "Library owner",
        },
    ).json()["data"]
    jwt = {"Authorization": f"Bearer {auth['access_token']}"}
    workspace = client.get("/workspaces", headers=jwt).json()["data"]["items"][0]["id"]
    jwt["X-Workspace-ID"] = workspace
    notebook = client.post("/notebooks", headers=jwt, json={"title": "Library"}).json()[
        "data"
    ]
    note = client.post(
        "/notes",
        headers=jwt,
        json={"notebook_id": notebook["id"], "title": "Rich document"},
    ).json()["data"]
    blocks = [
        {
            "id": "p1",
            "type": "paragraph",
            "props": {},
            "content": [
                {"type": "text", "text": "Draft", "styles": {"bold": True}},
                {"type": "text", "text": " text"},
            ],
            "children": [],
        },
        {
            "id": "container",
            "type": "group",
            "props": {},
            "content": [],
            "children": [
                {
                    "id": "child",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Kept child"}],
                    "children": [],
                }
            ],
        },
    ]
    assert (
        client.put(
            f"/notes/{note['id']}/content",
            headers=jwt,
            json={
                "expected_version": 1,
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": blocks,
                },
            },
        ).status_code
        == 200
    )
    response = client.post(
        "/integrations/tokens",
        headers=jwt,
        json={
            "name": "Test library",
            "permissions": ["notes:read", "notes:write"],
            "notebook_id": notebook["id"],
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["data"]
    return {
        "jwt": jwt,
        "headers": {
            "Authorization": f"Bearer {token['token']}",
            "X-Workspace-ID": workspace,
        },
        "workspace": workspace,
        "notebook": notebook,
        "note": note,
        "token": token,
        "blocks": blocks,
    }
