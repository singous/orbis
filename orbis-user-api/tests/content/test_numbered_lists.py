from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbis_user_api.domain.note_content import InvalidNoteContent, blocks_to_markdown, derive_plain_text, markdown_to_blocks, normalize_note_blocks


LIST_CHILD_MARKDOWN = [
    ("paragraph", "Continuation"),
    ("heading", "## Nested title"),
    ("bulletList", "- Child bullet"),
    ("orderedList", "3. Child three\n4. Child four"),
    ("taskList", "- [x] Child task"),
    ("blockquote", "> Child quote"),
    ("codeBlock", "```sh\necho hello\n```"),
    ("horizontalRule", "---"),
    ("table", "| Key | Value |\n| --- | --- |\n| Child | Table |"),
]


def list_child_markdown(list_type: str, child: str) -> str:
    first, second = {"orderedList": ("7. Install", "8. Run"), "bulletList": ("- Install", "- Run"), "taskList": ("- [x] Install", "- [ ] Run")}[list_type]
    indent = "   " if list_type == "orderedList" else "  "
    return first + "\n\n" + "\n".join(indent + line if line else "" for line in child.split("\n")) + "\n\n" + second


@pytest.mark.parametrize("list_type", ["orderedList", "bulletList", "taskList"])
@pytest.mark.parametrize(("child_type", "child_markdown"), LIST_CHILD_MARKDOWN)
def test_all_existing_blocks_remain_importable_inside_lists(list_type: str, child_type: str, child_markdown: str) -> None:
    imported = markdown_to_blocks(list_child_markdown(list_type, child_markdown))
    parent = imported["doc"]["content"][0]
    assert parent["type"] == list_type
    assert len(parent["content"]) == 2
    assert parent["content"][0]["content"][1]["type"] == child_type
    if list_type == "orderedList":
        assert parent["attrs"]["start"] == 7
    reimported = markdown_to_blocks(blocks_to_markdown(imported))
    assert reimported == imported
    assert derive_plain_text(reimported).startswith("Install")
    assert derive_plain_text(reimported).endswith("Run")


@pytest.mark.parametrize("child_type", ["doc", "text", "listItem", "taskItem", "tableRow", "tableCell", "tableHeader"])
def test_list_items_still_reject_nodes_that_are_not_document_blocks(child_type: str) -> None:
    document = {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": [{
        "type": "orderedList", "content": [{"type": "listItem", "content": [paragraph("Parent"), {"type": child_type}]}],
    }]}}
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document)


@pytest.mark.parametrize(("list_type", "child_type", "child_markdown"), [
    ("orderedList", "codeBlock", "```sh\necho hello\n```"),
    ("orderedList", "heading", "## Nested title"),
    ("taskList", "blockquote", "> Child quote"),
])
def test_import_api_preserves_previously_accepted_indented_list_blocks(
    list_type: str, child_type: str, child_markdown: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'import.db'}")
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes")
    monkeypatch.setenv("ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes")
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as client:
        setup = client.post("/setup", json={"email": "owner@example.com", "password": "correct horse battery staple", "display_name": "Owner"})
        assert setup.status_code == 201
        headers = {"Authorization": f"Bearer {setup.json()['data']['access_token']}"}
        notebook = client.post("/notebooks", headers=headers, json={"title": "List compatibility"}).json()["data"]
        imported = client.post("/notes/import/markdown", headers=headers, json={"notebook_id": notebook["id"], "title": "Install", "markdown": list_child_markdown(list_type, child_markdown)})
        assert imported.status_code == 201, imported.text
        note_id = imported.json()["data"]["id"]
        loaded = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
        parent = loaded["blocks"]["doc"]["content"][0]
        assert parent["type"] == list_type
        assert parent["content"][0]["content"][1]["type"] == child_type
        exported = client.get(f"/notes/{note_id}/markdown", headers=headers).json()["data"]["markdown"]
        assert markdown_to_blocks(exported) == loaded["blocks"]
        assert "Install" in loaded["plain_text"] and "Run" in loaded["plain_text"]


def paragraph(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def legacy_list(start: int, *items: str) -> dict[str, Any]:
    return {"type": "orderedList", "attrs": {"start": start}, "content": [
        {"type": "listItem", "content": [paragraph(text)]} for text in items
    ]}


def numbered_document(version: int) -> dict[str, Any]:
    if version == 1:
        first = legacy_list(7, "Seven", "Eight")
        first["content"][0]["content"].extend([
            paragraph("Continuation"),
            {"type": "bulletList", "content": [{"type": "listItem", "content": [paragraph("Nested bullet")]}]},
            legacy_list(3, "Nested three", "Nested four"), legacy_list(10, "Nested ten", "Nested eleven"),
        ])
        return {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": [
            first, legacy_list(20, "Twenty", "Twenty one"), paragraph("Between lists"), legacy_list(1, "One"),
        ]}}

    def item(text: str, start: int | None = None, children: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {"id": text, "type": "numberedListItem", "props": {} if start is None else {"start": start}, "content": text, "children": children or []}

    return {"schema_version": 2, "editor": "blocknote", "blocks": [
        item("Seven", 7, [
            {"id": "continuation", "type": "paragraph", "content": "Continuation"},
            {"id": "bullet", "type": "bulletListItem", "content": "Nested bullet"},
            item("Nested three", 3), item("Nested four"), item("Nested ten", 10), item("Nested eleven"),
        ]),
        item("Eight"), item("Twenty", 20), item("Twenty one"),
        {"id": "break", "type": "paragraph", "content": "Between lists"}, item("One"),
    ]}


def assert_imported_numbering(document: dict[str, Any]) -> None:
    nodes = document["doc"]["content"]
    lists = [node for node in nodes if node["type"] == "orderedList"]
    assert [node.get("attrs", {}).get("start", 1) for node in lists] == [7, 20, 1]
    assert [len(node["content"]) for node in lists] == [2, 2, 1]
    children = lists[0]["content"][0]["content"]
    nested = [node for node in children if node["type"] == "orderedList"]
    assert [node.get("attrs", {}).get("start", 1) for node in nested] == [3, 10]
    assert [len(node["content"]) for node in nested] == [2, 2]
    assert children[1] == paragraph("Continuation")
    assert children[2]["type"] == "bulletList"


@pytest.mark.parametrize("version", [1, 2])
def test_numbered_markdown_export_and_import_preserve_starts_restarts_and_nested_children(version: int) -> None:
    markdown = blocks_to_markdown(numbered_document(version))
    assert markdown.startswith("7. Seven")
    assert "8. Eight" in markdown
    assert "20) Twenty" in markdown
    assert "21) Twenty one" in markdown
    assert "Nested bullet" in markdown
    assert_imported_numbering(markdown_to_blocks(markdown))


def test_ordinary_lists_keep_their_default_numbering_inline_marks_and_literal_prefixes() -> None:
    document = markdown_to_blocks("1. [First](https://example.com)\n2. # Literal title\n\n- Bullet\n- [x] Done")
    nodes = document["doc"]["content"]
    assert [node["type"] for node in nodes] == ["orderedList", "bulletList", "taskList"]
    assert nodes[0]["attrs"]["start"] == 1
    assert nodes[0]["content"][0]["content"][0]["content"][0]["marks"] == [{"type": "link", "attrs": {"href": "https://example.com"}}]
    assert nodes[0]["content"][1]["content"] == [paragraph("# Literal title")]
    assert blocks_to_markdown(document) == "1. [First](https://example.com)\n2. # Literal title\n\n- Bullet\n\n- [x] Done"


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("task", [False, True])
def test_numbered_children_roundtrip_under_bullets_and_tasks(version: int, task: bool) -> None:
    if version == 1:
        item = {"type": "taskItem" if task else "listItem", "content": [paragraph("Parent"), legacy_list(7, "Seven", "Eight")]}
        if task:
            item["attrs"] = {"checked": True}
        document = {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": [{"type": "taskList" if task else "bulletList", "content": [item]}]}}
    else:
        document = {"schema_version": 2, "editor": "blocknote", "blocks": [{
            "id": "parent", "type": "checkListItem" if task else "bulletListItem", "props": {"checked": True}, "content": "Parent", "children": [
                {"id": "seven", "type": "numberedListItem", "props": {"start": 7}, "content": "Seven"},
                {"id": "eight", "type": "numberedListItem", "content": "Eight"},
            ],
        }]}
    imported = markdown_to_blocks(blocks_to_markdown(document))
    parent = imported["doc"]["content"][0]
    assert parent["type"] == ("taskList" if task else "bulletList")
    nested = parent["content"][0]["content"][1]
    assert nested["type"] == "orderedList"
    assert nested["attrs"]["start"] == 7
    assert len(nested["content"]) == 2


@pytest.mark.parametrize("version", [1, 2])
def test_numbered_lists_survive_save_api_markdown_export_and_reimport(
    version: int, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'lists.db'}")
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes")
    monkeypatch.setenv("ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes")
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as client:
        setup = client.post("/setup", json={"email": "owner@example.com", "password": "correct horse battery staple", "display_name": "Owner"})
        assert setup.status_code == 201
        headers = {"Authorization": f"Bearer {setup.json()['data']['access_token']}"}
        notebook = client.post("/notebooks", headers=headers, json={"title": "Lists"}).json()["data"]
        note = client.post("/notes", headers=headers, json={"notebook_id": notebook["id"], "title": "Numbered steps"}).json()["data"]
        document = numbered_document(version)
        saved = client.put(f"/notes/{note['id']}/content", headers=headers, json={"expected_version": 1, "blocks": document})
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["blocks"] == document
        exported = client.get(f"/notes/{note['id']}/markdown", headers=headers)
        assert exported.status_code == 200
        markdown = exported.json()["data"]["markdown"]
        assert markdown.startswith("7. Seven")
        imported = client.post("/notes/import/markdown", headers=headers, json={"notebook_id": notebook["id"], "title": "Imported steps", "markdown": markdown})
        assert imported.status_code == 201, imported.text
        loaded = client.get(f"/notes/{imported.json()['data']['id']}/content", headers=headers)
        assert loaded.status_code == 200
        assert_imported_numbering(loaded.json()["data"]["blocks"])
