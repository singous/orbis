from __future__ import annotations

import json
from pathlib import Path

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


def test_note_publication_creates_canonical_single_note_versions(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    token = owner["access_token"]
    knowledge_base = create_knowledge_base(client, token)
    notebook = client.post(
        "/notebooks", headers=auth_header(token), json={"title": "Notes"}
    ).json()
    parent = client.post(
        "/notes",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "Parent"},
    ).json()
    child = client.post(
        "/notes",
        headers=auth_header(token),
        json={
            "notebook_id": notebook["id"],
            "title": "Child",
            "parent_id": parent["id"],
        },
    ).json()
    first_content = {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "First version"}],
                }
            ],
        },
    }
    client.put(
        f"/notes/{parent['id']}/content",
        headers=auth_header(token),
        json={"expected_version": 1, "blocks": first_content},
    )

    first = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/notes/{parent['id']}",
        headers=auth_header(token),
    )
    duplicate = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/notes/{parent['id']}",
        headers=auth_header(token),
    )
    assert first.status_code == 202
    assert first.json()["version_number"] == 1
    assert duplicate.status_code == 409

    event = client.app.state.event_publisher.messages[-1][1]
    snapshot_path = client.app.state.storage.root / event.storage_key
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    assert snapshot["note"]["id"] == parent["id"]
    assert snapshot["note"]["title"] == "Parent"
    assert child["id"] not in snapshot_path.read_text(encoding="utf-8")
    assert "updated_at_ms" not in snapshot["note"]

    second_content = {
        **first_content,
        "doc": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Second version"}],
                }
            ],
        },
    }
    client.put(
        f"/notes/{parent['id']}/content",
        headers=auth_header(token),
        json={"expected_version": 2, "blocks": second_content},
    )
    second = client.post(
        f"/knowledge-bases/{knowledge_base['id']}/sources/notes/{parent['id']}",
        headers=auth_header(token),
    )
    assert second.status_code == 202
    assert second.json()["source_id"] == first.json()["source_id"]
    assert second.json()["version_number"] == 2
    assert second.json()["source_version_id"] != first.json()["source_version_id"]

    delete_response = client.delete(
        f"/knowledge-bases/{knowledge_base['id']}/sources/{first.json()['source_id']}",
        headers=auth_header(token),
    )
    assert delete_response.status_code == 204
    assert (
        client.get(f"/notes/{parent['id']}", headers=auth_header(token)).status_code
        == 200
    )
