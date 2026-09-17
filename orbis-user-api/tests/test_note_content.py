from __future__ import annotations

from pathlib import Path
from typing import Any

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


def setup_note(client: TestClient) -> tuple[str, dict[str, Any], dict[str, Any]]:
    setup_response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup_response.status_code == 201
    token = setup_response.json()["data"]["access_token"]
    notebook_response = client.post(
        "/notebooks",
        headers=auth_header(token),
        json={"title": "Product notes"},
    )
    assert notebook_response.status_code == 201
    notebook = notebook_response.json()["data"]
    note_response = client.post(
        "/notes",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "MVP", "sort_order": 0},
    )
    assert note_response.status_code == 201
    return token, notebook, note_response.json()["data"]


def supported_blocks() -> dict[str, Any]:
    paragraph = lambda text: {
        "type": "paragraph",
        "content": [{"type": "text", "text": text}],
    }
    return {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "Architecture"}],
                },
                paragraph("Orbis keeps structured content."),
                {
                    "type": "bulletList",
                    "content": [{"type": "listItem", "content": [paragraph("Bullet")]}],
                },
                {
                    "type": "orderedList",
                    "content": [
                        {"type": "listItem", "content": [paragraph("Ordered")]}
                    ],
                },
                {
                    "type": "taskList",
                    "content": [
                        {
                            "type": "taskItem",
                            "attrs": {"checked": True},
                            "content": [paragraph("Task")],
                        }
                    ],
                },
                {"type": "blockquote", "content": [paragraph("Quote")]},
                {
                    "type": "codeBlock",
                    "attrs": {"language": "python"},
                    "content": [{"type": "text", "text": "print('orbis')"}],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "Docs",
                            "marks": [
                                {
                                    "type": "link",
                                    "attrs": {"href": "https://example.com/docs"},
                                }
                            ],
                        }
                    ],
                },
                {"type": "horizontalRule"},
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableHeader", "content": [paragraph("Name")]},
                                {
                                    "type": "tableHeader",
                                    "content": [paragraph("State")],
                                },
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "content": [paragraph("Orbis")]},
                                {"type": "tableCell", "content": [paragraph("Ready")]},
                            ],
                        },
                    ],
                },
            ],
        },
    }


def test_note_content_is_separate_and_uses_optimistic_lock(client: TestClient) -> None:
    token, _, note = setup_note(client)

    initial_response = client.get(
        f"/notes/{note['id']}/content", headers=auth_header(token)
    )
    update_response = client.put(
        f"/notes/{note['id']}/content",
        headers=auth_header(token),
        json={
            "expected_version": 1,
            "blocks": supported_blocks(),
            "plain_text": "forged",
        },
    )
    conflict_response = client.put(
        f"/notes/{note['id']}/content",
        headers=auth_header(token),
        json={"expected_version": 1, "blocks": supported_blocks()},
    )

    assert initial_response.status_code == 200
    assert initial_response.json()["data"]["content_version"] == 1
    assert initial_response.json()["data"]["blocks"]["doc"]["type"] == "doc"
    assert update_response.status_code == 200
    content = update_response.json()["data"]
    assert content["content_version"] == 2
    assert "Architecture" in content["plain_text"]
    assert "Orbis keeps structured content." in content["plain_text"]
    assert content["plain_text"] != "forged"
    assert conflict_response.status_code == 409


def test_note_content_rejects_unknown_block_type(client: TestClient) -> None:
    token, _, note = setup_note(client)

    response = client.put(
        f"/notes/{note['id']}/content",
        headers=auth_header(token),
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {"type": "doc", "content": [{"type": "iframe"}]},
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "NOTE_CONTENT_INVALID"
    assert response.json()["message"] == "文档内容无效"


def test_v2_table_content_round_trips_and_contributes_plain_text(
    client: TestClient,
) -> None:
    token, _, note = setup_note(client)
    table = {
        "id": "018ff7c4-a5b6-7000-8000-000000000099",
        "type": "table",
        "props": {"textColor": "default"},
        "content": {
            "type": "tableContent",
            "columnWidths": [180, 240],
            "headerRows": 1,
            "rows": [
                {"cells": ["块类型", "检查重点"]},
                {"cells": ["表格", "边框与滚动"]},
            ],
        },
        "children": [],
    }

    response = client.put(
        f"/notes/{note['id']}/content",
        headers=auth_header(token),
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [table],
            },
        },
    )

    assert response.status_code == 200
    content = response.json()["data"]
    assert content["blocks"]["blocks"][0]["content"] == table["content"]
    assert content["plain_text"] == "块类型\t检查重点\n表格\t边框与滚动"
    loaded = client.get(
        f"/notes/{note['id']}/content", headers=auth_header(token)
    )
    assert loaded.json()["data"]["blocks"] == content["blocks"]
    exported = client.get(
        f"/notes/{note['id']}/markdown", headers=auth_header(token)
    )
    assert exported.status_code == 200
    assert exported.json()["data"]["markdown"] == (
        "| 块类型 | 检查重点 |\n| --- | --- |\n| 表格 | 边框与滚动 |"
    )


@pytest.mark.parametrize(("block_list", "expected_text", "expected_markdown"), [
    (
        [
            {"id": "old", "type": "paragraph", "content": "Legacy paragraph"},
            {"id": "parent", "type": "paragraph", "content": "Parent", "children": [
                {"id": "nested", "type": "paragraph", "content": "Nested paragraph"},
                {"id": "empty", "type": "paragraph"},
            ]},
        ],
        "Legacy paragraph\nParent\nNested paragraph",
        "Legacy paragraph\n\nParent\n\n  Nested paragraph",
    ),
    (
        [{"id": "old-table", "type": "table", "content": [
            [[{"type": "text", "text": "Name", "styles": {"bold": True}}], [{"type": "text", "text": "State"}]],
            [[{"type": "link", "href": "https://orbis.dev", "content": [{"type": "text", "text": "Orbis"}]}], "Ready"],
        ]}],
        "Name\tState\nOrbis\tReady",
        "| **Name** | State |\n| --- | --- |\n| [Orbis](https://orbis.dev) | Ready |",
    ),
])
def test_legacy_v2_content_can_still_be_saved_read_and_exported(
    client: TestClient, block_list: list[dict[str, Any]], expected_text: str, expected_markdown: str,
) -> None:
    token, _, note = setup_note(client)
    blocks = {"schema_version": 2, "editor": "blocknote", "blocks": block_list}
    saved = client.put(
        f"/notes/{note['id']}/content", headers=auth_header(token),
        json={"expected_version": 1, "blocks": blocks},
    )
    assert saved.status_code == 200
    assert saved.json()["data"]["blocks"] == blocks
    assert saved.json()["data"]["plain_text"] == expected_text
    loaded = client.get(f"/notes/{note['id']}/content", headers=auth_header(token))
    assert loaded.json()["data"]["blocks"] == blocks
    exported = client.get(f"/notes/{note['id']}/markdown", headers=auth_header(token))
    assert exported.status_code == 200
    assert exported.json()["data"]["markdown"] == expected_markdown


def test_markdown_import_and_export_cover_supported_boundary_types(
    client: TestClient,
) -> None:
    token, notebook, _ = setup_note(client)
    markdown = """# Product plan

Read the [documentation](https://example.com/docs).

- Bullet
- [x] Shipped

1. First

> A quote

```python
print("orbis")
```

---

| Name | State |
| --- | --- |
| Orbis | Ready |
"""

    import_response = client.post(
        "/notes/import/markdown",
        headers=auth_header(token),
        json={"notebook_id": notebook["id"], "title": "Imported", "markdown": markdown},
    )

    assert import_response.status_code == 201
    imported = import_response.json()["data"]
    content_response = client.get(
        f"/notes/{imported['id']}/content", headers=auth_header(token)
    )
    node_types = [
        node["type"] for node in content_response.json()["data"]["blocks"]["doc"]["content"]
    ]
    assert node_types == [
        "heading",
        "paragraph",
        "bulletList",
        "taskList",
        "orderedList",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "table",
    ]

    export_response = client.get(
        f"/notes/{imported['id']}/markdown", headers=auth_header(token)
    )
    assert export_response.status_code == 200
    exported = export_response.json()["data"]["markdown"]
    assert "# Product plan" in exported
    assert "[documentation](https://example.com/docs)" in exported
    assert "- [x] Shipped" in exported
    assert "```python" in exported
    assert "| Orbis | Ready |" in exported
