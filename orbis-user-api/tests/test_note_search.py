from __future__ import annotations

from pathlib import Path

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

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_note_search_uses_title_and_derived_body_and_excludes_archived(
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
    token = setup_response.json()["access_token"]
    notebook = client.post(
        "/notebooks", headers=auth_header(token), json={"title": "Search"}
    ).json()

    title_note = client.post(
        "/notes",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "Graph retrieval"},
    ).json()
    body_note = client.post(
        "/notes",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "Architecture"},
    ).json()
    archived_note = client.post(
        "/notes",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "Old graph notes"},
    ).json()
    body_update = client.put(
        f"/notes/{body_note['id']}/content",
        headers=auth_header(token),
        json={
            "expected_version": 1,
            "plain_text": "forged text must not be searchable",
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "text": "Hybrid graph ranking"}
                            ],
                        }
                    ],
                },
            },
        },
    )
    assert body_update.status_code == 200
    assert (
        client.post(
            f"/notes/{archived_note['id']}/archive", headers=auth_header(token)
        ).status_code
        == 200
    )

    response = client.get("/notes", headers=auth_header(token), params={"q": "graph"})
    forged_response = client.get(
        "/notes", headers=auth_header(token), params={"q": "forged"}
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        body_note["id"],
        title_note["id"],
    ]
    assert forged_response.json()["items"] == []
