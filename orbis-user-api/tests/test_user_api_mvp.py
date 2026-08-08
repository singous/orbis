from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


PASSWORD = "correct horse battery staple"


def test_database_schema_is_not_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIS_DATABASE_URL", "postgresql+asyncpg://example:secret@localhost/orbis")
    monkeypatch.delenv("ORBIS_DATABASE_SCHEMA", raising=False)

    from orbis_user_api.core.settings import Settings

    assert Settings().database_schema is None


@pytest.fixture()
def storage_dir(tmp_path: Path) -> Path:
    return tmp_path / "storage"


@pytest.fixture()
def client(tmp_path: Path, storage_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(storage_dir))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes")
    monkeypatch.setenv("ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes")

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def setup_owner(client: TestClient) -> str:
    response = client.post(
        "/setup",
        json={"email": "owner@example.com", "password": PASSWORD, "display_name": "Owner"},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_document_groups_notebooks_and_documents_keep_working_on_unversioned_routes(client: TestClient) -> None:
    owner_token = setup_owner(client)

    groups_response = client.get("/document-groups", headers=auth_header(owner_token))
    assert groups_response.status_code == 200
    default_group = groups_response.json()["items"][0]
    assert default_group["name"] == "默认分组"
    assert default_group["is_default"] is True

    notebook_response = client.post(
        "/notebooks",
        headers=auth_header(owner_token),
        json={"title": "产品设计", "group_id": None, "sort_order": 10},
    )
    assert notebook_response.status_code == 201
    notebook = notebook_response.json()
    assert notebook["group_id"] == default_group["id"]

    document_response = client.post(
        "/documents",
        headers=auth_header(owner_token),
        json={
            "title": "第一篇文档",
            "notebook_id": notebook["id"],
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {"type": "doc", "content": []},
            },
            "plain_text": "",
        },
    )
    assert document_response.status_code == 201
    document = document_response.json()
    assert document["content_version"] == 1
    assert document["note_type"] == "doc"

    list_response = client.get("/documents", headers=auth_header(owner_token))
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["id"] == document["id"]
    assert "blocks" not in list_response.json()["items"][0]

    stale_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(owner_token),
        json={"expected_version": 0, "blocks": {"schema_version": 1, "doc": {"type": "doc"}}, "plain_text": ""},
    )
    assert stale_response.status_code == 422

    update_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(owner_token),
        json={
            "expected_version": 1,
            "title": "改名后的文档",
            "blocks": {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": []}},
            "plain_text": "updated",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["content_version"] == 2

    conflict_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(owner_token),
        json={"expected_version": 1, "blocks": {"schema_version": 1, "doc": {"type": "doc"}}, "plain_text": ""},
    )
    assert conflict_response.status_code == 409

def test_files_keep_working_on_unversioned_routes(client: TestClient, storage_dir: Path) -> None:
    access_token = setup_owner(client)

    upload_response = client.post(
        "/files",
        headers=auth_header(access_token),
        files={"file": ("hello.txt", b"hello file", "text/plain")},
    )
    assert upload_response.status_code == 201
    uploaded = upload_response.json()
    assert uploaded["original_filename"] == "hello.txt"
    assert uploaded["mime_type"] == "text/plain"
    assert uploaded["file_size"] == 10
    assert uploaded["upload_status"] == "completed"
    assert (storage_dir / uploaded["storage_key"]).exists()

    list_response = client.get("/files", headers=auth_header(access_token))
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [uploaded["id"]]
