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


class FailingPublisher:
    async def publish(self, topic: str, payload: Any) -> None:
        del topic, payload
        raise RuntimeError("Kafka is unavailable")


def test_failed_publish_job_can_retry_without_creating_new_source_or_version(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    client.app.state.event_publisher = FailingPublisher()

    failed = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/files",
        headers=auth_header(token),
        files={"file": ("guide.md", b"# Guide", "text/markdown")},
    )

    assert failed.status_code == 503
    job_id = failed.json()["detail"]["processing_job_id"]
    failed_job = client.get(
        f"/processing-jobs/{job_id}", headers=auth_header(token)
    ).json()
    assert failed_job["status"] == "failed"
    assert "unavailable" in failed_job["error_summary"].lower()

    from orbis_user_api.infrastructure.events import InMemoryEventPublisher

    publisher = InMemoryEventPublisher()
    client.app.state.event_publisher = publisher
    retry = client.post(f"/processing-jobs/{job_id}/retry", headers=auth_header(token))
    second_retry = client.post(
        f"/processing-jobs/{job_id}/retry", headers=auth_header(token)
    )

    assert retry.status_code == 202
    assert retry.json()["status"] == "created"
    assert retry.json()["attempt_count"] == 2
    assert second_retry.status_code == 409
    event = publisher.messages[0][1]
    assert str(event.source_id) == failed.json()["detail"]["source_id"]
    assert str(event.source_version_id) == failed.json()["detail"]["source_version_id"]
    assert event.source_hash == failed.json()["detail"]["source_hash"]
