from uuid import UUID, uuid4

from orbis_user_api.models.workspace import WorkspaceMember
from sqlalchemy import select


def edit():
    return {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "replace_text",
                "block_id": "p1",
                "expected_block_revision": 2,
                "match": "Draft",
                "replacement": "Approved",
            }
        ],
    }


def test_atomic_preview_idempotent_roundtrip_and_format(client, library):
    note = library["note"]["id"]
    headers = library["headers"]
    payload = edit()
    url = f"/open/v1/notes/{note}"
    preview = client.post(url + "/operations/preview", headers=headers, json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["durability"] == "preview"
    assert client.get(url, headers=headers).json()["data"]["content_version"] == 2
    assert (
        client.get(
            f"/open/v1/operations/{payload['operation_id']}", headers=headers
        ).status_code
        == 404
    )
    first = client.post(url + "/operations", headers=headers, json=payload)
    assert first.status_code == 200, first.text
    second = client.post(url + "/operations", headers=headers, json=payload)
    assert second.status_code == 200 and second.json()["data"] == first.json()["data"]
    receipt = client.get(
        f"/open/v1/operations/{payload['operation_id']}", headers=headers
    )
    assert receipt.json()["data"] == first.json()["data"]
    block = client.get(
        url + "/blocks/p1", headers=headers, params={"min_version": 3}
    ).json()["data"]
    assert block["block"]["content"][0] == {
        "type": "text",
        "text": "Approved",
        "styles": {"bold": True},
    }
    assert block["block"]["content"][1]["text"] == " text"
    child = client.get(url + "/blocks/child", headers=headers).json()["data"]
    assert child["block"]["content"][0]["text"] == "Kept child"
    old = client.get(url + "/blocks/p1", headers=headers, params={"version": 2}).json()[
        "data"
    ]
    assert old["block"]["content"][0]["text"] == "Draft"
    payload["operations"][0]["replacement"] = "Another"
    assert (
        client.post(url + "/operations", headers=headers, json=payload).json()["code"]
        == "IDEMPOTENCY_KEY_REUSED"
    )
    assert client.get(
        url + "/changes", headers=headers, params={"since_version": 2}
    ).json()["data"]["items"] == [{"id": "p1", "change": "upsert", "block_revision": 3}]


def test_batch_rolls_back_and_conflict_never_overwrites(client, library):
    url = f"/open/v1/notes/{library['note']['id']}"
    payload = edit()
    payload["operations"].append(
        {"type": "move_block", "block_id": "container", "parent_id": "child"}
    )
    response = client.post(
        url + "/operations", headers=library["headers"], json=payload
    )
    assert response.status_code == 422
    assert (
        client.get(url, headers=library["headers"]).json()["data"]["content_version"]
        == 2
    )
    block = client.get(url + "/blocks/p1", headers=library["headers"]).json()["data"]
    assert block["block"]["content"][0]["text"] == "Draft"
    valid = edit()
    assert (
        client.post(
            url + "/operations", headers=library["headers"], json=valid
        ).status_code
        == 200
    )
    old = edit()
    response = client.post(url + "/operations", headers=library["headers"], json=old)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "NOTE_VERSION_CONFLICT"


def test_scope_enforced_across_discovery_raw_and_operation_results(client, library):
    headers = library["headers"]
    notebook = client.post(
        "/notebooks", headers=library["jwt"], json={"title": "Other"}
    ).json()["data"]
    outside = client.post(
        "/notes",
        headers=library["jwt"],
        json={"notebook_id": notebook["id"], "title": "Outside"},
    ).json()["data"]
    assert (
        client.get(
            f"/open/v1/notes/{outside['id']}/blocks", headers=headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/open/v1/resolve", headers=headers, json={"note_id": outside["id"]}
        ).status_code
        == 404
    )
    assert (
        client.get("/open/v1/search", headers=headers, params={"q": "Outside"}).json()[
            "data"
        ]["items"]
        == []
    )
    assert (
        len(client.get("/open/v1/notebooks", headers=headers).json()["data"]["items"])
        == 1
    )
    assert client.get("/notes", headers=headers).status_code == 401
    assert (
        client.get(
            "/open/v1/notes", headers={"Authorization": headers["Authorization"]}
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/open/v1/notes", headers={**headers, "X-Workspace-ID": str(uuid4())}
        ).status_code
        == 403
    )
    readonly = client.post(
        "/integrations/tokens",
        headers=library["jwt"],
        json={
            "name": "Read only",
            "permissions": ["notes:read"],
            "note_id": library["note"]["id"],
        },
    ).json()["data"]
    rh = {**headers, "Authorization": f"Bearer {readonly['token']}"}
    assert (
        client.post(
            f"/open/v1/notes/{library['note']['id']}/operations",
            headers=rh,
            json=edit(),
        ).status_code
        == 403
    )
    assert (
        client.get("/open/v1/notes", headers=rh).json()["data"]["items"][0]["id"]
        == library["note"]["id"]
    )
    listing = client.get("/integrations/tokens", headers=library["jwt"]).json()["data"]
    assert "secret_hash" not in str(listing) and readonly["token"] not in str(listing)


def test_revoke_expiry_and_member_downgrade_are_live(client, library):
    headers = library["headers"]

    async def downgrade():
        async with client.app.state.session_factory() as session:
            member = await session.scalar(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == UUID(library["workspace"])
                )
            )
            member.role = "normal"
            await session.commit()

    client.portal.call(downgrade)
    assert client.get("/open/v1/notes", headers=headers).status_code == 200
    assert (
        client.post(
            f"/open/v1/notes/{library['note']['id']}/operations",
            headers=headers,
            json=edit(),
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/integrations/tokens/{library['token']['id']}/revoke",
            headers=library["jwt"],
        ).status_code
        == 200
    )
    assert client.get("/open/v1/notes", headers=headers).status_code == 401


def test_create_markdown_export_and_idempotent_create(client, library):
    payload = {
        "operation_id": str(uuid4()),
        "notebook_id": library["notebook"]["id"],
        "title": "Agent draft",
        "markdown": "# Plan\n\nContent with **bold** text.",
    }
    first = client.post("/open/v1/notes", headers=library["headers"], json=payload)
    assert first.status_code == 201, first.text
    repeated = client.post("/open/v1/notes", headers=library["headers"], json=payload)
    assert repeated.json()["data"] == first.json()["data"]
    note = first.json()["data"]["note_id"]
    exported = client.get(
        f"/open/v1/notes/{note}/export",
        headers=library["headers"],
        params={"version": 1, "format": "markdown"},
    )
    assert exported.status_code == 200, exported.text
    assert "**bold**" in exported.json()["data"]["content"]
    outline = client.get(
        f"/open/v1/notes/{note}/outline", headers=library["headers"]
    ).json()["data"]
    assert outline["items"][0]["text"] == "Plan"
    search = client.get(
        "/open/v1/search", headers=library["headers"], params={"q": "bold"}
    )
    assert note in [item["id"] for item in search.json()["data"]["items"]]


def test_attachment_roundtrip_scope_and_shares_are_independent(client, library):
    import hashlib

    token = client.post(
        "/integrations/tokens",
        headers=library["jwt"],
        json={
            "name": "Media and live share",
            "permissions": [
                "notes:read",
                "notes:write",
                "files:read",
                "files:write",
                "shares:manage",
            ],
            "notebook_id": library["notebook"]["id"],
        },
    ).json()["data"]
    headers = {**library["headers"], "Authorization": f"Bearer {token['token']}"}
    note = library["note"]["id"]
    content = b"An attachment with useful content"
    operation = str(uuid4())
    url = f"/open/v1/notes/{note}/files"
    uploaded = client.post(
        url,
        headers=headers,
        data={"operation_id": operation, "sha256": hashlib.sha256(content).hexdigest()},
        files={"file": ("attachment.txt", content, "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text
    data = uploaded.json()["data"]
    repeated = client.post(
        url,
        headers=headers,
        data={"operation_id": operation, "sha256": hashlib.sha256(content).hexdigest()},
        files={"file": ("attachment.txt", content, "text/plain")},
    )
    assert repeated.json()["data"]["id"] == data["id"]
    downloaded = client.get(url + "/" + data["id"] + "/content", headers=headers)
    assert downloaded.content == content
    assert (
        client.get(url + "/" + data["id"], headers=library["headers"]).status_code
        == 403
    )
    outside = client.post(
        "/notes",
        headers=library["jwt"],
        json={
            "notebook_id": library["notebook"]["id"],
            "title": "Other authorized note",
        },
    ).json()["data"]
    assert (
        client.get(
            f"/open/v1/notes/{outside['id']}/files/{data['id']}", headers=headers
        ).status_code
        == 404
    )
    share = client.post(
        "/open/v1/shares",
        headers=headers,
        json={
            "notebook_id": library["notebook"]["id"],
            "root_note_id": note,
            "acknowledge_public_scope": True,
        },
    )
    assert share.status_code == 201, share.text
    shared = share.json()["data"]
    assert shared["behavior"] == "live"
    assert (
        client.get(shared["path"].replace("/share/", "/public/shares/")).status_code
        == 200
    )
    assert (
        client.post(
            f"/open/v1/shares/{shared['id']}/revoke", headers=headers
        ).status_code
        == 200
    )
    restricted = client.post(
        "/integrations/tokens",
        headers=library["jwt"],
        json={
            "name": "One doc",
            "permissions": ["notes:read", "shares:manage"],
            "note_id": note,
        },
    ).json()["data"]
    assert (
        client.post(
            "/open/v1/shares",
            headers={**headers, "Authorization": f"Bearer {restricted['token']}"},
            json={
                "notebook_id": library["notebook"]["id"],
                "root_note_id": note,
                "acknowledge_public_scope": True,
            },
        ).status_code
        == 403
    )


def test_title_edit_is_atomic_conditional_and_preview_does_not_rename(client, library):
    note = library["note"]["id"]
    path = f"/open/v1/notes/{note}"
    current = client.get(path, headers=library["headers"]).json()["data"]
    payload = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "update_metadata",
                "expected_updated_at_ms": current["updated_at_ms"],
                "title": "Renamed by agent",
            }
        ],
    }
    response = client.post(
        path + "/operations/preview", headers=library["headers"], json=payload
    )
    assert response.status_code == 200, response.text
    assert (
        client.get(path, headers=library["headers"]).json()["data"]["title"]
        == current["title"]
    )
    response = client.post(
        path + "/operations", headers=library["headers"], json=payload
    )
    assert response.status_code == 200, response.text
    assert (
        client.get(path, headers=library["headers"]).json()["data"]["title"]
        == "Renamed by agent"
    )


def test_guessed_private_file_cannot_gain_a_grant_through_an_insert(client, library):
    upload = client.post(
        "/files",
        headers=library["jwt"],
        files={"file": ("private.txt", b"private content", "text/plain")},
    ).json()["data"]
    payload = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "insert_blocks",
                "blocks": [
                    {
                        "type": "file",
                        "props": {
                            "url": f"orbis-file:{upload['id']}",
                            "name": "private.txt",
                        },
                        "content": [],
                    }
                ],
            }
        ],
    }
    path = f"/open/v1/notes/{library['note']['id']}"
    response = client.post(
        path + "/operations", headers=library["headers"], json=payload
    )
    assert response.status_code == 403
    assert (
        client.get(path, headers=library["headers"]).json()["data"]["content_version"]
        == 2
    )


def test_markdown_export_reports_native_components_and_nonportable_style(
    client, library
):
    payload = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "insert_blocks",
                "after_id": "container",
                "blocks": [
                    {
                        "id": "native-callout",
                        "type": "callout",
                        "props": {"tone": "warning", "title": "Review"},
                        "content": [
                            {
                                "type": "text",
                                "text": "Underlined",
                                "styles": {"underline": True},
                            }
                        ],
                    }
                ],
            }
        ],
    }
    path = f"/open/v1/notes/{library['note']['id']}"
    assert (
        client.post(
            path + "/operations", headers=library["headers"], json=payload
        ).status_code
        == 200
    )
    markdown = client.get(
        path + "/export",
        headers=library["headers"],
        params={"version": 3, "format": "markdown"},
    ).json()["data"]
    loss = next(
        item for item in markdown["losses"] if item["block_id"] == "native-callout"
    )
    assert "component_type" in loss["fields"] and "styles.underline" in loss["fields"]
    assert markdown["preserves_block_ids"] is False
    native = client.get(
        path + "/export",
        headers=library["headers"],
        params={"version": 3, "format": "json"},
    ).json()["data"]
    assert native["losses"] == [] and native["preserves_block_ids"] is True


def test_overlapping_text_matches_are_ambiguous_instead_of_silent_first_replace():
    import pytest
    from orbis_user_api.api.errors import ApiError
    from orbis_user_api.application.library_operations import replace_text

    with pytest.raises(ApiError) as raised:
        replace_text(
            {"type": "paragraph", "content": [{"type": "text", "text": "哈哈哈"}]},
            "哈哈",
            "好",
        )
    assert raised.value.code == "TEXT_MATCH_CONFLICT"


def test_search_returns_a_bounded_anchor_for_far_inside_a_long_block(client, library):
    path = f"/open/v1/notes/{library['note']['id']}"
    payload = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "update_block",
                "block_id": "p1",
                "block": {
                    "id": "p1",
                    "type": "paragraph",
                    "props": {},
                    "content": [
                        {
                            "type": "text",
                            "text": "a" * 8192 + " searchable-anchor " + "b" * 8192,
                        }
                    ],
                },
            }
        ],
    }
    assert (
        client.post(
            path + "/operations", headers=library["headers"], json=payload
        ).status_code
        == 200
    )
    response = client.get(
        "/open/v1/search", headers=library["headers"], params={"q": "searchable-anchor"}
    ).json()["data"]
    item = response["items"][0]
    assert item["content_version"] == 3
    assert item["matches"][0]["block_id"] == "p1"
    assert "searchable-anchor" in item["matches"][0]["snippet"]
    assert len(item["matches"][0]["snippet"]) <= 160


def test_unicode_create_budget_is_measured_in_bytes(client, library):
    payload = {
        "operation_id": str(uuid4()),
        "notebook_id": library["notebook"]["id"],
        "title": "Oversized create",
        "markdown": "文" * 400000,
    }
    response = client.post("/open/v1/notes", headers=library["headers"], json=payload)
    assert response.status_code == 422
    found = client.post(
        "/open/v1/resolve",
        headers=library["headers"],
        json={"title": "Oversized create"},
    ).json()["data"]
    assert found["items"] == []


def test_combined_title_and_body_batch_has_one_atomic_result(client, library):
    path = f"/open/v1/notes/{library['note']['id']}"
    current = client.get(path, headers=library["headers"]).json()["data"]
    request = {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "update_metadata",
                "expected_updated_at_ms": current["updated_at_ms"],
                "title": "Atomic renamed document",
            },
            {
                "type": "replace_text",
                "block_id": "p1",
                "match": "Draft",
                "replacement": "Atomic body",
            },
        ],
    }
    response = client.post(
        path + "/operations", headers=library["headers"], json=request
    )
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["metadata_updated_at_ms"] > current["updated_at_ms"]
    assert (
        client.get(path, headers=library["headers"]).json()["data"]["title"]
        == "Atomic renamed document"
    )
    assert (
        client.get(path + "/blocks/p1", headers=library["headers"]).json()["data"][
            "block"
        ]["content"][0]["text"]
        == "Atomic body"
    )


def test_ui_metadata_timestamp_strictly_advances_even_when_clock_is_unchanged(
    client, library, monkeypatch
):
    from orbis_user_api.application import notes

    note = library["note"]["id"]
    current = client.get(f"/notes/{note}", headers=library["jwt"]).json()["data"]
    monkeypatch.setattr(notes, "now_ms", lambda: current["updated_at_ms"])
    one = client.patch(
        f"/notes/{note}", headers=library["jwt"], json={"title": "One"}
    ).json()["data"]
    two = client.patch(
        f"/notes/{note}", headers=library["jwt"], json={"title": "Two"}
    ).json()["data"]
    assert one["updated_at_ms"] == current["updated_at_ms"] + 1
    assert two["updated_at_ms"] == one["updated_at_ms"] + 1


def test_oversized_own_body_stub_still_allows_bounded_discovery(client, library):
    body = "large own payload " * 20000
    note = library["note"]["id"]
    parent = "opaque-parent-" + "x" * (512 - len("opaque-parent-"))
    assert (
        client.put(
            f"/notes/{note}/content",
            headers=library["jwt"],
            json={
                "expected_version": 2,
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": [
                        {
                            "id": "large",
                            "type": "paragraph",
                            "props": {},
                            "content": [{"type": "text", "text": body}],
                            "children": [],
                        },
                        library["blocks"][0],
                        {
                            "id": parent,
                            "type": "group",
                            "props": {},
                            "content": [],
                            "children": [
                                {
                                    "id": "opaque-child",
                                    "type": "paragraph",
                                    "props": {},
                                    "content": [
                                        {"type": "text", "text": "Legal child"}
                                    ],
                                    "children": [],
                                }
                            ],
                        },
                    ],
                },
            },
        ).status_code
        == 200
    )
    response = client.get(f"/open/v1/notes/{note}/blocks", headers=library["headers"])
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(response.content) < 131072
    assert data["descriptors"][0]["payload_loaded"] is False
    assert data["next_offset"] > 0

    exact = client.get(
        f"/open/v1/notes/{note}/blocks/large", headers=library["headers"]
    )
    assert (
        exact.status_code == 200
        and exact.json()["data"]["block"]["content"][0]["text"] == body
    )
    child = client.get(
        f"/open/v1/notes/{note}/blocks",
        headers=library["headers"],
        params={"parent_id": parent},
    )
    assert (
        child.status_code == 200
        and child.json()["data"]["blocks"]["blocks"][0]["id"] == "opaque-child"
    )
