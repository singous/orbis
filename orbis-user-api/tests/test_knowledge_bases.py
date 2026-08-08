from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from knowledge_helpers import (
    auth_header,
    create_knowledge_base,
    invite_member,
    setup_owner,
)


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


class FailingIndexCleanup:
    async def remove_knowledge_base(self, **scope: Any) -> None:
        del scope
        raise RuntimeError("Elasticsearch is unavailable")

    async def remove_source(self, **scope: Any) -> None:
        del scope


class FailingStorageDeletion:
    def __init__(self, storage: Any) -> None:
        self.root = storage.root

    async def delete(self, storage_key: str) -> None:
        del storage_key
        raise OSError("storage permission denied")


def test_knowledge_base_crud_and_role_permissions(client: TestClient) -> None:
    owner = setup_owner(client)
    owner_token = owner["access_token"]
    editor = invite_member(
        client, owner_token, email="editor@example.com", role="editor"
    )
    normal = invite_member(
        client, owner_token, email="normal@example.com", role="normal"
    )

    knowledge_base = create_knowledge_base(client, editor["access_token"])
    update = client.patch(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(editor["access_token"]),
        json={"name": "Orbis handbook", "description": "Updated"},
    )
    normal_list = client.get(
        "/knowledge-bases", headers=auth_header(normal["access_token"])
    )
    normal_create = client.post(
        "/knowledge-bases",
        headers=auth_header(normal["access_token"]),
        json={"name": "Forbidden"},
    )
    editor_delete = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(editor["access_token"]),
        params={"confirmation": "Orbis handbook"},
    )

    assert update.status_code == 200
    assert update.json()["name"] == "Orbis handbook"
    assert [item["id"] for item in normal_list.json()["items"]] == [
        knowledge_base["id"]
    ]
    assert normal_create.status_code == 403
    assert editor_delete.status_code == 403

    wrong_confirmation = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(owner_token),
        params={"confirmation": "wrong"},
    )
    delete_response = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(owner_token),
        params={"confirmation": "Orbis handbook"},
    )
    assert wrong_confirmation.status_code == 409
    assert delete_response.status_code == 204
    assert (
        client.get("/knowledge-bases", headers=auth_header(owner_token)).json()["items"]
        == []
    )


def test_knowledge_base_delete_failure_is_visible_and_retryable(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    client.app.state.index_cleanup = FailingIndexCleanup()

    failed = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(token),
        params={"confirmation": knowledge_base["name"]},
    )

    assert failed.status_code == 502
    assert failed.json()["detail"] == "Knowledge base cleanup failed"
    listed = client.get("/knowledge-bases", headers=auth_header(token)).json()["items"]
    assert listed[0]["status"] == "deletion_failed"
    assert "unavailable" in listed[0]["deletion_error_summary"].lower()

    from orbis_user_api.infrastructure.index_cleanup import NoOpIndexCleanupGateway

    client.app.state.index_cleanup = NoOpIndexCleanupGateway()
    retried = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(token),
        params={"confirmation": knowledge_base["name"]},
    )
    assert retried.status_code == 204


def test_knowledge_base_storage_cleanup_failure_retains_business_records(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    uploaded = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("guide.txt", b"guide", "text/plain")},
    )
    assert uploaded.status_code == 202
    client.app.state.storage = FailingStorageDeletion(client.app.state.storage)

    response = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}",
        headers=auth_header(token),
        params={"confirmation": knowledge_base["name"]},
    )

    assert response.status_code == 502
    listed = client.get("/knowledge-bases", headers=auth_header(token)).json()["items"]
    assert listed[0]["status"] == "deletion_failed"
    assert "permission denied" in listed[0]["deletion_error_summary"]
    sources = client.get(
        f"/knowledge-bases/{knowledge_base['id']}/sources",
        headers=auth_header(token),
    ).json()["items"]
    assert len(sources) == 1
