from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_database_schema_is_not_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIS_DATABASE_URL", "postgresql+asyncpg://example:secret@localhost/orbis")
    monkeypatch.delenv("ORBIS_DATABASE_SCHEMA", raising=False)

    from orbis_user_api.core.settings import Settings

    assert Settings().database_schema is None


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes")
    monkeypatch.setenv("ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes")

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def register(client: TestClient, email: str = "ada@example.com") -> tuple[str, str]:
    response = client.post(
        "/v1/auth/register",
        json={"email": email, "password": "correct horse battery staple", "display_name": "Ada"},
    )
    assert response.status_code == 201
    payload = response.json()
    return payload["access_token"], payload["user"]["id"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_register_login_and_current_user(client: TestClient) -> None:
    access_token, user_id = register(client)

    me_response = client.get("/v1/users/me", headers=auth_header(access_token))
    assert me_response.status_code == 200
    assert me_response.json()["id"] == user_id
    assert me_response.json()["email"] == "ada@example.com"

    duplicate_response = client.post(
        "/v1/auth/register",
        json={"email": "ada@example.com", "password": "correct horse battery staple"},
    )
    assert duplicate_response.status_code == 409

    login_response = client.post(
        "/v1/auth/login",
        json={"email": "ada@example.com", "password": "correct horse battery staple"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["access_token"]
    assert login_response.json()["refresh_token"]


def test_notes_are_owned_and_use_optimistic_versions(client: TestClient) -> None:
    access_token, _ = register(client)

    create_response = client.post(
        "/v1/notes",
        headers=auth_header(access_token),
        json={
            "title": "Orbis first note",
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Hello Orbis"}],
                        }
                    ],
                },
            },
            "plain_text": "Hello Orbis",
        },
    )
    assert create_response.status_code == 201
    note = create_response.json()
    assert note["content_version"] == 1
    assert note["blocks"]["editor"] == "tiptap"

    list_response = client.get("/v1/notes", headers=auth_header(access_token))
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["id"] == note["id"]
    assert "blocks" not in list_response.json()["items"][0]

    update_response = client.put(
        f"/v1/notes/{note['id']}/content",
        headers=auth_header(access_token),
        json={
            "expected_version": 1,
            "title": "Renamed Orbis note",
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Updated"}],
                        }
                    ],
                },
            },
            "plain_text": "Updated",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["content_version"] == 2
    assert update_response.json()["title"] == "Renamed Orbis note"

    stale_response = client.put(
        f"/v1/notes/{note['id']}/content",
        headers=auth_header(access_token),
        json={"expected_version": 1, "blocks": {"schema_version": 1, "doc": {"type": "doc"}}, "plain_text": ""},
    )
    assert stale_response.status_code == 409

    other_token, _ = register(client, email="grace@example.com")
    forbidden_response = client.get(f"/v1/notes/{note['id']}", headers=auth_header(other_token))
    assert forbidden_response.status_code == 404


def test_files_are_uploaded_and_listed_by_owner(client: TestClient, tmp_path: Path) -> None:
    access_token, _ = register(client)

    upload_response = client.post(
        "/v1/files",
        headers=auth_header(access_token),
        files={"file": ("hello.txt", b"hello file", "text/plain")},
    )
    assert upload_response.status_code == 201
    uploaded = upload_response.json()
    assert uploaded["original_filename"] == "hello.txt"
    assert uploaded["mime_type"] == "text/plain"
    assert uploaded["file_size"] == 10
    assert uploaded["upload_status"] == "completed"
    assert (tmp_path / "storage" / uploaded["storage_key"]).exists()

    list_response = client.get("/v1/files", headers=auth_header(access_token))
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [uploaded["id"]]

    other_token, _ = register(client, email="grace@example.com")
    other_list_response = client.get("/v1/files", headers=auth_header(other_token))
    assert other_list_response.status_code == 200
    assert other_list_response.json()["items"] == []
