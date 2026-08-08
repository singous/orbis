from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from knowledge_helpers import auth_header, create_knowledge_base, setup_owner


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


class FailingSourceCleanup:
    async def remove_knowledge_base(self, **scope: Any) -> None:
        del scope

    async def remove_source(self, **scope: Any) -> None:
        del scope
        raise RuntimeError("index cleanup timed out")


class FailingStorageDeletion:
    def __init__(self, storage: Any) -> None:
        self.root = storage.root

    async def delete(self, storage_key: str) -> None:
        del storage_key
        raise OSError("storage is read only")


def test_file_upload_returns_before_processing_and_rejects_same_hash_in_one_kb(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)

    first = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("guide.md", b"# Guide", "text/markdown")},
    )
    duplicate = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("renamed.md", b"# Guide", "text/markdown")},
    )

    assert first.status_code == 202
    assert first.json()["processing_status"] == "created"
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["existing_source_id"] == first.json()["source_id"]
    sources = client.get(
        f"/knowledge-bases/{knowledge_base['id']}/sources",
        headers=auth_header(token),
    ).json()["items"]
    assert len(sources) == 1
    assert sources[0]["filename"] == "guide.md"
    assert sources[0]["source_hash"] == first.json()["source_hash"]
    assert len(client.app.state.event_publisher.messages) == 1


@pytest.mark.parametrize(
    ("filename", "mime_type"),
    [
        ("guide.md", "text/markdown"),
        ("guide.txt", "text/plain"),
        ("guide.pdf", "application/pdf"),
        (
            "guide.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    ],
)
def test_supported_file_types_are_accepted(
    client: TestClient, filename: str, mime_type: str
) -> None:
    owner = setup_owner(client)
    knowledge_base = create_knowledge_base(client, owner["access_token"])
    response = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(owner["access_token"]),
        files={"file": (filename, filename.encode(), mime_type)},
    )
    assert response.status_code == 202


def test_unsupported_file_type_is_rejected(client: TestClient) -> None:
    owner = setup_owner(client)
    knowledge_base = create_knowledge_base(client, owner["access_token"])
    response = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(owner["access_token"]),
        files={"file": ("image.png", b"png", "image/png")},
    )
    assert response.status_code == 415


def test_source_delete_cleanup_failure_keeps_metadata_for_retry(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    uploaded = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("guide.txt", b"guide", "text/plain")},
    ).json()
    client.app.state.index_cleanup = FailingSourceCleanup()

    failed = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}/sources/{uploaded['source_id']}",
        headers=auth_header(token),
    )
    assert failed.status_code == 502
    source = client.get(
        f"/knowledge-bases/{knowledge_base['id']}/sources",
        headers=auth_header(token),
    ).json()["items"][0]
    assert source["status"] == "deletion_failed"

    from orbis_user_api.infrastructure.index_cleanup import NoOpIndexCleanupGateway

    client.app.state.index_cleanup = NoOpIndexCleanupGateway()
    retried = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}/sources/{uploaded['source_id']}",
        headers=auth_header(token),
    )
    assert retried.status_code == 204


def test_source_storage_cleanup_failure_keeps_source_visible(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    uploaded = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("guide.txt", b"guide", "text/plain")},
    ).json()
    client.app.state.storage = FailingStorageDeletion(client.app.state.storage)

    response = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}/sources/{uploaded['source_id']}",
        headers=auth_header(token),
    )

    assert response.status_code == 502
    source = client.get(
        f"/knowledge-bases/{knowledge_base['id']}/sources",
        headers=auth_header(token),
    ).json()["items"][0]
    assert source["status"] == "deletion_failed"
    assert "read only" in source["deletion_error_summary"]
