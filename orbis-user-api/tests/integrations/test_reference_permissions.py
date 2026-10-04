from uuid import uuid4

import pytest
from sqlalchemy import event


@pytest.fixture()
def restricted(client, library):
    token = client.post(
        "/integrations/tokens",
        headers=library["jwt"],
        json={
            "name": "Restricted writer",
            "permissions": ["notes:read", "notes:write", "shares:manage"],
            "notebook_id": library["notebook"]["id"],
        },
    ).json()["data"]
    private = client.post(
        "/files",
        headers=library["jwt"],
        files={
            "file": ("private.txt", b"private bytes must stay private", "text/plain")
        },
    ).json()["data"]
    return {**library["headers"], "Authorization": "Bearer " + token["token"]}, private


def inline(reference):
    return {
        "type": "link",
        "href": reference,
        "content": [{"type": "text", "text": "Private link"}],
    }


@pytest.mark.parametrize("shape", ["inline", "card", "table", "media", "legacy_mark"])
def test_every_rendered_file_reference_rejects_a_guessed_private_id(
    client, library, restricted, shape
):
    headers, private = restricted
    reference = "orbis-file:" + private["id"]
    block = {
        "id": "guessed",
        "type": "paragraph",
        "props": {},
        "content": [inline(reference)],
    }
    if shape == "card":
        block = {
            "id": "guessed",
            "type": "card",
            "props": {"title": "Card", "href": reference},
            "content": [],
        }
    elif shape == "table":
        block = {
            "id": "guessed",
            "type": "table",
            "props": {},
            "content": {
                "type": "tableContent",
                "rows": [{"cells": [[inline(reference)]]}],
            },
        }
    elif shape == "media":
        block = {
            "id": "guessed",
            "type": "image",
            "props": {"url": reference},
            "content": [],
        }
    elif shape == "legacy_mark":
        block["content"] = [
            {
                "type": "text",
                "text": "Private",
                "marks": [{"type": "link", "attrs": {"href": reference}}],
            }
        ]
    payload = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [{"type": "insert_blocks", "blocks": [block]}],
    }
    path = f"/open/v1/notes/{library['note']['id']}"
    for suffix in ("/operations/preview", "/operations"):
        response = client.post(path + suffix, headers=headers, json=payload)
        assert response.status_code == 403, response.text
    assert client.get(path, headers=headers).json()["data"]["content_version"] == 2
    share = client.post(
        "/open/v1/shares",
        headers=headers,
        json={
            "notebook_id": library["notebook"]["id"],
            "root_note_id": library["note"]["id"],
            "acknowledge_public_scope": True,
        },
    ).json()["data"]
    token = share["path"].rsplit("/", 1)[1]
    public = client.get(
        f"/public/shares/{token}/notes/{library['note']['id']}/files/{private['id']}"
    )
    assert public.status_code == 404
    assert b"private bytes" not in public.content


def test_plain_edit_never_scans_note_payloads_for_file_grants(client, library):
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.post(
            f"/open/v1/notes/{library['note']['id']}/operations",
            headers=library["headers"],
            json={
                "operation_id": str(uuid4()),
                "expected_version": 2,
                "operations": [
                    {
                        "type": "replace_text",
                        "block_id": "p1",
                        "match": "Draft",
                        "replacement": "Reviewed",
                    }
                ],
            },
        )
        assert response.status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert not any("CAST(note_block_versions.payload" in query for query in statements)


def test_existing_authorized_card_and_inline_reference_survive_a_text_edit(
    client, library, restricted
):
    headers, private = restricted
    reference = "orbis-file:" + private["id"]
    note = library["note"]["id"]
    existing = {
        "id": "authorized-card",
        "type": "card",
        "props": {"title": "Current card", "href": reference},
        "content": [],
        "children": [],
    }
    assert (
        client.put(
            f"/notes/{note}/content",
            headers=library["jwt"],
            json={
                "expected_version": 2,
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": [existing],
                },
            },
        ).status_code
        == 200
    )
    updated = {key: value for key, value in existing.items() if key != "children"}
    updated["props"] = {**updated["props"], "title": "Renamed card"}
    response = client.post(
        f"/open/v1/notes/{note}/operations",
        headers=headers,
        json={
            "operation_id": str(uuid4()),
            "expected_version": 3,
            "operations": [
                {
                    "type": "update_block",
                    "block_id": "authorized-card",
                    "block": updated,
                }
            ],
        },
    )
    assert response.status_code == 200, response.text


def test_markdown_constructor_cannot_publish_a_guessed_private_link(
    client, library, restricted
):
    headers, private = restricted
    response = client.post(
        "/open/v1/notes",
        headers=headers,
        json={
            "operation_id": str(uuid4()),
            "notebook_id": library["notebook"]["id"],
            "title": "Forbidden constructor",
            "markdown": f"[Private](orbis-file:{private['id']})",
        },
    )
    assert response.status_code == 403, response.text
    assert (
        client.post(
            "/open/v1/resolve", headers=headers, json={"title": "Forbidden constructor"}
        ).json()["data"]["items"]
        == []
    )


def test_inert_props_and_deleted_legacy_editor_cache_never_grant_public_bytes(
    client, library, restricted
):
    from orbis_user_api.domain.document_references import managed_file_ids

    headers, private = restricted
    reference = "orbis-file:" + private["id"]
    hidden = {
        "type": "file",
        "props": {"url": reference},
        "content": [],
        "children": [],
    }
    block = {
        "id": "inert-metadata",
        "type": "paragraph",
        "props": {"hidden": hidden},
        "attrs": {"orbisOriginal": hidden},
        "content": [{"type": "text", "text": "Visible text only"}],
        "children": [],
    }
    assert managed_file_ids(block) == set()
    assert (
        client.put(
            f"/notes/{library['note']['id']}/content",
            headers=library["jwt"],
            json={
                "expected_version": 2,
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": [block],
                },
            },
        ).status_code
        == 200
    )
    share = client.post(
        "/open/v1/shares",
        headers=headers,
        json={
            "notebook_id": library["notebook"]["id"],
            "root_note_id": library["note"]["id"],
            "acknowledge_public_scope": True,
        },
    ).json()["data"]
    token = share["path"].rsplit("/", 1)[1]
    response = client.get(
        f"/public/shares/{token}/notes/{library['note']['id']}/files/{private['id']}"
    )
    assert response.status_code == 404
    assert b"private bytes" not in response.content
