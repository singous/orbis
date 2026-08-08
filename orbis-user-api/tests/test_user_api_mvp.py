from __future__ import annotations

import json
from pathlib import Path
from typing import Any

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
    monkeypatch.setenv("ORBIS_BOOTSTRAP_SUPERUSER_ENABLED", "true")
    monkeypatch.setenv("ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes")
    monkeypatch.setenv("ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes")

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def latest_email_code(storage_dir: Path, email: str, purpose: str = "register") -> str:
    outbox_path = storage_dir / "email_outbox.jsonl"
    assert outbox_path.exists()
    messages = [json.loads(line) for line in outbox_path.read_text().splitlines() if line.strip()]
    matches = [
        message
        for message in messages
        if message["email"] == email.strip().lower() and message["purpose"] == purpose
    ]
    assert matches
    return matches[-1]["code"]


def send_email_code(client: TestClient, storage_dir: Path, email: str) -> str:
    response = client.post("/auth/email-codes", json={"email": email, "purpose": "register"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["expires_at_ms"] > payload["resend_after_ms"]
    return latest_email_code(storage_dir, email)


def register(client: TestClient, storage_dir: Path, email: str = "ada@example.com") -> tuple[str, str, dict[str, Any]]:
    code = send_email_code(client, storage_dir, email)
    response = client.post(
        "/auth/register",
        json={"email": email, "code": code, "password": PASSWORD, "display_name": "Ada"},
    )
    assert response.status_code == 201
    payload = response.json()
    return payload["access_token"], payload["user"]["id"], payload["user"]


def test_email_code_registration_bootstrap_user_and_unversioned_routes(
    client: TestClient,
    storage_dir: Path,
) -> None:
    missing_code_response = client.post(
        "/auth/register",
        json={"email": "ada@example.com", "password": PASSWORD, "display_name": "Ada"},
    )
    assert missing_code_response.status_code == 422

    access_token, user_id, user = register(client, storage_dir, email=" ADA@example.com ")
    assert user["email"] == "ada@example.com"
    assert user["is_superuser"] is False
    assert user["current_workspace_id"] is not None

    me_response = client.get("/users/me", headers=auth_header(access_token))
    assert me_response.status_code == 200
    assert me_response.json()["id"] == user_id

    duplicate_response = client.post(
        "/auth/register",
        json={"email": "ada@example.com", "code": send_email_code(client, storage_dir, "ada@example.com"), "password": PASSWORD},
    )
    assert duplicate_response.status_code == 409

    admin_login_response = client.post(
        "/auth/login",
        json={"email": "admin@orbis.com", "password": "orbis_admin"},
    )
    assert admin_login_response.status_code == 200
    assert admin_login_response.json()["user"]["is_superuser"] is True
    assert admin_login_response.json()["user"]["current_workspace_id"] is not None

    versioned_response = client.get("/v1/users/me", headers=auth_header(access_token))
    assert versioned_response.status_code == 404


def test_workspace_queries_switching_and_member_management(client: TestClient, storage_dir: Path) -> None:
    ada_token, _, _ = register(client, storage_dir, email="ada@example.com")
    grace_token, _, _ = register(client, storage_dir, email="grace@example.com")

    ada_workspaces_response = client.get("/workspaces", headers=auth_header(ada_token))
    assert ada_workspaces_response.status_code == 200
    ada_workspace = ada_workspaces_response.json()["items"][0]
    assert ada_workspace["role"] == "owner"
    assert ada_workspace["is_current"] is True

    grace_workspaces_response = client.get("/workspaces", headers=auth_header(grace_token))
    assert grace_workspaces_response.status_code == 200
    assert len(grace_workspaces_response.json()["items"]) == 1

    add_member_response = client.post(
        f"/workspaces/{ada_workspace['id']}/members",
        headers=auth_header(ada_token),
        json={"email": "grace@example.com"},
    )
    assert add_member_response.status_code == 201
    added_member = add_member_response.json()
    assert added_member["role"] == "member"
    assert added_member["status"] == "active"

    grace_after_add_response = client.get("/workspaces", headers=auth_header(grace_token))
    assert grace_after_add_response.status_code == 200
    grace_workspaces = grace_after_add_response.json()["items"]
    assert {item["id"] for item in grace_workspaces} == {ada_workspace["id"], grace_workspaces_response.json()["items"][0]["id"]}

    switch_response = client.put(
        "/workspaces/current",
        headers=auth_header(grace_token),
        json={"workspace_id": ada_workspace["id"]},
    )
    assert switch_response.status_code == 200
    assert switch_response.json()["id"] == ada_workspace["id"]
    assert switch_response.json()["role"] == "member"

    member_add_response = client.post(
        f"/workspaces/{ada_workspace['id']}/members",
        headers=auth_header(grace_token),
        json={"email": "admin@orbis.com"},
    )
    assert member_add_response.status_code == 403

    members_response = client.get(f"/workspaces/{ada_workspace['id']}/members", headers=auth_header(grace_token))
    assert members_response.status_code == 200
    assert {member["email"] for member in members_response.json()["items"]} == {"ada@example.com", "grace@example.com"}

    remove_response = client.delete(
        f"/workspaces/{ada_workspace['id']}/members/{added_member['id']}",
        headers=auth_header(ada_token),
    )
    assert remove_response.status_code == 204

    removed_member_response = client.get(f"/workspaces/{ada_workspace['id']}/members", headers=auth_header(grace_token))
    assert removed_member_response.status_code == 404


def test_document_groups_notebooks_documents_and_member_access(client: TestClient, storage_dir: Path) -> None:
    ada_token, _, _ = register(client, storage_dir, email="ada@example.com")
    grace_token, _, _ = register(client, storage_dir, email="grace@example.com")

    groups_response = client.get("/document-groups", headers=auth_header(ada_token))
    assert groups_response.status_code == 200
    default_group = groups_response.json()["items"][0]
    assert default_group["name"] == "默认分组"
    assert default_group["is_default"] is True

    notebook_response = client.post(
        "/notebooks",
        headers=auth_header(ada_token),
        json={"title": "产品设计", "group_id": None, "sort_order": 10},
    )
    assert notebook_response.status_code == 201
    notebook = notebook_response.json()
    assert notebook["group_id"] == default_group["id"]

    document_response = client.post(
        "/documents",
        headers=auth_header(ada_token),
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

    list_response = client.get("/documents", headers=auth_header(ada_token))
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["id"] == document["id"]
    assert "blocks" not in list_response.json()["items"][0]

    stale_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(ada_token),
        json={"expected_version": 0, "blocks": {"schema_version": 1, "doc": {"type": "doc"}}, "plain_text": ""},
    )
    assert stale_response.status_code == 422

    update_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(ada_token),
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
        headers=auth_header(ada_token),
        json={"expected_version": 1, "blocks": {"schema_version": 1, "doc": {"type": "doc"}}, "plain_text": ""},
    )
    assert conflict_response.status_code == 409

    non_member_response = client.get(f"/documents/{document['id']}", headers=auth_header(grace_token))
    assert non_member_response.status_code == 404

    ada_workspace = client.get("/workspaces/current", headers=auth_header(ada_token)).json()
    client.post(
        f"/workspaces/{ada_workspace['id']}/members",
        headers=auth_header(ada_token),
        json={"email": "grace@example.com"},
    )
    client.put("/workspaces/current", headers=auth_header(grace_token), json={"workspace_id": ada_workspace["id"]})

    member_get_response = client.get(f"/documents/{document['id']}", headers=auth_header(grace_token))
    assert member_get_response.status_code == 200
    assert member_get_response.json()["id"] == document["id"]

    member_update_response = client.put(
        f"/documents/{document['id']}/content",
        headers=auth_header(grace_token),
        json={
            "expected_version": 2,
            "blocks": {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": []}},
            "plain_text": "member update",
        },
    )
    assert member_update_response.status_code == 200
    assert member_update_response.json()["content_version"] == 3


def test_files_keep_working_on_unversioned_routes(client: TestClient, storage_dir: Path) -> None:
    access_token, _, _ = register(client, storage_dir)

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
