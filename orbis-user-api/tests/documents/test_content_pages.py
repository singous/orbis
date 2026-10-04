from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'pages.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "files"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "isolated-pages-access-secret-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "isolated-pages-refresh-secret-at-least-32-bytes"
    )
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as value:
        yield value


def seed(client: TestClient, roots=None):
    auth = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": "Orbis-pages-isolated-2026!",
            "display_name": "Owner",
        },
    ).json()["data"]
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    notebook = client.post(
        "/notebooks", headers=headers, json={"title": "Paged notes"}
    ).json()["data"]
    note = client.post(
        "/notes",
        headers=headers,
        json={"notebook_id": notebook["id"], "title": "A long note"},
    ).json()["data"]
    blocks = (
        roots
        if roots is not None
        else [
            {
                "id": f"paragraph-{index}",
                "type": "paragraph",
                "props": {},
                "content": [
                    {"type": "text", "text": f"Paragraph {index}: " + "a" * 1024}
                ],
                "children": [],
            }
            for index in range(512)
        ]
    )
    saved = client.put(
        f"/notes/{note['id']}/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": blocks},
        },
    )
    assert saved.status_code == 200
    return note["id"], headers, saved.json()["data"]["blocks"]["blocks"]


def test_initial_read_is_bounded_and_does_not_duplicate_plaintext(client):
    note_id, headers, original = seed(client)
    url = f"/notes/{note_id}/content"
    response = client.get(url, headers=headers, params={"offset": 0, "limit": 32})
    assert response.status_code == 200
    page = response.json()["data"]
    assert page["blocks"]["blocks"] == original[:32]
    assert (
        page["total_blocks"] == 512 and page["next_offset"] == 32 and page["has_more"]
    )
    assert "plain_text" not in page
    assert len(response.content) < 64 * 1024
    next_page = client.get(
        url,
        headers=headers,
        params={"offset": 32, "limit": 32, "expected_version": page["content_version"]},
    ).json()["data"]
    assert next_page["blocks"]["blocks"] == original[32:64]
    full = client.get(url, headers=headers).json()["data"]
    assert len(full["blocks"]["blocks"]) == 512 and "plain_text" in full


def test_saving_a_loaded_prefix_preserves_the_unloaded_tail_and_history(client):
    note_id, headers, original = seed(client)
    prefix = [
        *original[:32],
        {
            "id": "new-block",
            "type": "paragraph",
            "props": {},
            "content": [{"type": "text", "text": "New text"}],
            "children": [],
        },
    ]
    response = client.patch(
        f"/notes/{note_id}/content",
        headers=headers,
        json={
            "expected_version": 2,
            "loaded_block_ids": [block["id"] for block in original[:32]],
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": prefix},
        },
    )
    assert response.status_code == 200
    ack = response.json()["data"]
    assert ack["content_version"] == 3 and ack["total_blocks"] == 513
    assert "blocks" not in ack and "plain_text" not in ack
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["blocks"]["blocks"][33:] == original[32:]
    assert "New text" in full["plain_text"]
    original_page = client.get(
        f"/notes/{note_id}/content",
        headers=headers,
        params={"offset": 32, "limit": 32, "expected_version": 2},
    ).json()["data"]
    assert original_page["blocks"]["blocks"] == original[32:64]
    assert original_page["content_version"] == 2
    revisions = client.get(f"/notes/{note_id}/revisions", headers=headers).json()[
        "data"
    ]
    assert len(revisions["items"]) >= 2


def test_stale_pages_and_incorrect_prefix_identity_are_rejected(client):
    note_id, headers, _ = seed(client)
    stale = client.get(
        f"/notes/{note_id}/content",
        headers=headers,
        params={"limit": 32, "expected_version": 999},
    )
    assert stale.status_code == 409
    response = client.patch(
        f"/notes/{note_id}/content",
        headers=headers,
        json={
            "expected_version": 2,
            "loaded_block_ids": ["not-the-first-block"],
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": []},
        },
    )
    assert response.status_code == 409
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["content_version"] == 2 and len(full["blocks"]["blocks"]) == 512


def test_legacy_read_is_paged_without_rewriting_the_stored_format(client):
    note_id, headers, _ = seed(client, [])
    legacy = {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": str(index)}]}
                for index in range(96)
            ],
        },
    }
    saved = client.put(
        f"/notes/{note_id}/content",
        headers=headers,
        json={"expected_version": 2, "blocks": legacy},
    )
    assert saved.status_code == 200
    page = client.get(
        f"/notes/{note_id}/content", headers=headers, params={"offset": 32, "limit": 32}
    ).json()["data"]
    assert page["blocks"]["schema_version"] == 2 and len(page["blocks"]["blocks"]) == 32
    assert page["blocks"]["blocks"][0]["id"] == f"legacy-{note_id}-32"
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["blocks"] == legacy and full["content_version"] == 3


def test_outline_projects_heading_metadata_without_returning_the_document(client):
    roots = [
        {
            "id": f"item-{index}",
            "type": "heading" if index in {0, 100} else "paragraph",
            "props": {"level": 2} if index in {0, 100} else {},
            "content": [{"type": "text", "text": f"Text {index}"}],
            "children": [],
        }
        for index in range(160)
    ]
    note_id, headers, _ = seed(client, roots)
    response = client.get(
        f"/notes/{note_id}/content/outline", headers=headers, params={"version": 2}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert [item["root_index"] for item in data["items"]] == [0, 100]
    assert data["items"][1]["text"] == "Text 100"
    assert len(response.content) < 2048


def test_prefix_rejects_duplicate_and_unloaded_id_collisions_without_mutating(client):
    note_id, headers, original = seed(client)
    for prefix in ([original[0], original[0]], [original[32]]):
        response = client.patch(
            f"/notes/{note_id}/content",
            headers=headers,
            json={
                "expected_version": 2,
                "loaded_block_ids": [original[0]["id"]],
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": prefix,
                },
            },
        )
        assert response.status_code == 422
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["content_version"] == 2 and full["blocks"]["blocks"] == original


def test_legacy_prefix_save_preserves_nested_lists_tables_and_marks(client):
    note_id, headers, _ = seed(client, [])

    def paragraph(label):
        return {
            "type": "paragraph",
            "content": [{"type": "text", "text": label, "marks": [{"type": "bold"}]}],
        }

    legacy = {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                paragraph("Editable prefix"),
                {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "Unloaded heading"}],
                },
                {
                    "type": "orderedList",
                    "attrs": {"start": 7},
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                paragraph("List item"),
                                {
                                    "type": "bulletList",
                                    "content": [
                                        {
                                            "type": "listItem",
                                            "content": [paragraph("Nested item")],
                                        }
                                    ],
                                },
                            ],
                        }
                    ],
                },
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableHeader",
                                    "attrs": {"colspan": 2, "colwidth": [120, 160]},
                                    "content": [paragraph("Header")],
                                },
                                {"type": "tableCell", "content": [paragraph("Cell")]},
                            ],
                        }
                    ],
                },
            ],
        },
    }
    assert (
        client.put(
            f"/notes/{note_id}/content",
            headers=headers,
            json={"expected_version": 2, "blocks": legacy},
        ).status_code
        == 200
    )
    first = client.get(
        f"/notes/{note_id}/content", headers=headers, params={"limit": 1}
    ).json()["data"]
    tail = client.get(
        f"/notes/{note_id}/content",
        headers=headers,
        params={"offset": 1, "limit": 32, "expected_version": 3},
    ).json()["data"]["blocks"]["blocks"]
    assert tail[1]["props"]["start"] == 7
    assert tail[1]["children"][0]["content"][0]["styles"] == {"bold": True}
    assert tail[2]["content"]["columnWidths"] == [120, 160, None]
    prefix = first["blocks"]
    prefix["blocks"][0]["content"][0]["text"] = "Updated prefix"
    saved = client.patch(
        f"/notes/{note_id}/content",
        headers=headers,
        json={
            "expected_version": 3,
            "loaded_block_ids": [prefix["blocks"][0]["id"]],
            "blocks": prefix,
        },
    )
    assert saved.status_code == 200
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["blocks"]["blocks"][1:] == tail
    outline = client.get(
        f"/notes/{note_id}/content/outline", headers=headers, params={"version": 3}
    ).json()["data"]
    assert outline["items"][0]["text"] == "Unloaded heading"
    stale = client.get(
        f"/notes/{note_id}/content/outline", headers=headers, params={"version": 999}
    )
    assert stale.status_code == 409
