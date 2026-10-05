from uuid import uuid4


def seed(client):
    auth = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": "Orbis-table-isolated-2026!",
            "display_name": "Owner",
        },
    ).json()["data"]
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    notebook = client.post(
        "/notebooks", headers=headers, json={"title": "Tables"}
    ).json()["data"]
    note = client.post(
        "/notes", headers=headers, json={"notebook_id": notebook["id"], "title": "Data"}
    ).json()["data"]
    base = f"/notes/{note['id']}"
    block = {
        "id": "table-block",
        "type": "dataTable",
        "props": {},
        "content": [],
        "children": [],
    }
    saved = client.put(
        base + "/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": [block]},
        },
    )
    assert saved.status_code == 200, saved.text
    created = client.post(
        base + "/tables",
        headers=headers,
        json={
            "operation_id": str(uuid4()),
            "expected_document_version": 2,
            "block_id": block["id"],
        },
    )
    assert created.status_code == 201, created.text
    state = created.json()["data"]
    url = base + "/tables/" + state["table_id"]
    page = client.get(url, headers=headers)
    assert page.status_code == 200, page.text
    return headers, base, url, state, page.json()["data"]


def mutation(state, **kwargs):
    return {
        "operation_id": str(uuid4()),
        "expected_document_version": state["content_version"],
        "expected_table_revision": state["table_revision"],
        **kwargs,
    }


def test_records_views_and_document_reference_commit_together(client):
    headers, base, url, state, page = seed(client)
    field = page["definition"]["fields"][0]["id"]
    payload = mutation(
        state,
        upserts=[
            {"id": str(uuid4()), "values": {field: f"Row {i:03}"}} for i in range(100)
        ],
    )
    result = client.patch(url, headers=headers, json=payload)
    assert result.status_code == 200, result.text
    state = result.json()["data"]
    page = client.get(url, headers=headers, params={"offset": 90, "limit": 10}).json()[
        "data"
    ]
    assert page["total"] == 100 and len(page["records"]) == 10 and not page["has_more"]
    block = client.get(base + "/blocks/table-block", headers=headers).json()["data"]
    assert block["content_version"] == state["content_version"] == 4
    assert block["block"]["props"]["table_revision"] == 2
    replay = client.patch(url, headers=headers, json=payload)
    assert replay.status_code == 200 and replay.json()["data"] == state
    payload["upserts"][0]["values"][field] = "Different"
    assert client.patch(url, headers=headers, json=payload).status_code == 422


def test_type_failure_and_stale_writer_leave_no_partial_records(client):
    headers, base, url, state, page = seed(client)
    date = page["definition"]["fields"][2]["id"]
    bad = client.patch(
        url,
        headers=headers,
        json=mutation(state, upserts=[{"values": {date: "tomorrow"}}]),
    )
    assert bad.status_code == 422, bad.text
    assert client.get(url, headers=headers).json()["data"]["total"] == 0
    good = client.patch(
        url,
        headers=headers,
        json=mutation(state, upserts=[{"values": {date: 1780000000000}}]),
    )
    assert good.status_code == 200, good.text
    stale = client.patch(
        url, headers=headers, json=mutation(state, upserts=[{"values": {date: None}}])
    )
    assert stale.status_code == 409
    assert client.get(url, headers=headers).json()["data"]["total"] == 1


def test_filter_sort_and_group_count_are_over_the_complete_dataset(client):
    headers, _, url, state, page = seed(client)
    definition = page["definition"]
    title, status = definition["fields"][:2]
    option = status["options"][1]["id"]
    for batch in range(3):
        result = client.patch(
            url,
            headers=headers,
            json=mutation(
                state,
                upserts=[
                    {
                        "values": {
                            title["id"]: f"Record {batch * 100 + i:03}",
                            status["id"]: option if i % 2 else None,
                        }
                    }
                    for i in range(100)
                ],
            ),
        )
        assert result.status_code == 200, result.text
        state = result.json()["data"]
    definition["views"][0]["filters"] = [
        {"field_id": status["id"], "operator": "eq", "value": option}
    ]
    definition["views"][0]["sorts"] = [{"field_id": title["id"], "descending": True}]
    definition["views"][0]["group_field_id"] = status["id"]
    result = client.patch(
        url, headers=headers, json=mutation(state, definition=definition)
    )
    assert result.status_code == 200, result.text
    page = client.get(url, headers=headers, params={"limit": 10}).json()["data"]
    assert page["total"] == 150 and len(page["records"]) == 10
    assert page["records"][0]["values"][title["id"]] == "Record 299"
    assert (
        next(group["count"] for group in page["groups"] if group["id"] == option) == 150
    )
    export = client.get(url + "/export", headers=headers)
    assert export.status_code == 200 and len(export.text.splitlines()) == 151


def test_historical_reference_branches_without_changing_old_values(client):
    headers, base, url, state, page = seed(client)
    field = page["definition"]["fields"][0]["id"]
    record_id = str(uuid4())
    first = client.patch(
        url,
        headers=headers,
        json=mutation(state, upserts=[{"id": record_id, "values": {field: "Before"}}]),
    ).json()["data"]
    second = client.patch(
        url,
        headers=headers,
        json=mutation(first, upserts=[{"id": record_id, "values": {field: "After"}}]),
    ).json()["data"]
    restored = client.patch(
        base + "/blocks",
        headers=headers,
        json={
            "expected_version": second["content_version"],
            "upserts": [{k: v for k, v in first["block"].items() if k != "children"}],
        },
    ).json()["data"]
    old = client.get(url, headers=headers).json()["data"]
    assert old["records"][0]["values"][field] == "Before"
    next_state = {
        "content_version": restored["content_version"],
        "table_revision": old["revision"],
    }
    result = client.patch(
        url,
        headers=headers,
        json=mutation(
            next_state, upserts=[{"id": record_id, "values": {field: "New branch"}}]
        ),
    )
    assert result.status_code == 200, result.text
    assert (
        client.get(url, headers=headers).json()["data"]["records"][0]["values"][field]
        == "New branch"
    )


def test_deleted_block_removes_live_access_but_keeps_recoverable_data(client):
    headers, base, url, state, _ = seed(client)
    result = client.patch(
        base + "/blocks",
        headers=headers,
        json={"expected_version": state["content_version"], "deletes": ["table-block"]},
    )
    assert result.status_code == 200, result.text
    assert client.get(url, headers=headers).status_code == 404
    shallow = {k: v for k, v in state["block"].items() if k != "children"}
    result = client.patch(
        base + "/blocks",
        headers=headers,
        json={
            "expected_version": result.json()["data"]["content_version"],
            "upserts": [shallow],
            "moves": [{"id": "table-block", "parent_id": None, "after_id": None}],
        },
    )
    assert result.status_code == 200, result.text
    assert client.get(url, headers=headers).status_code == 200


def test_duplicate_block_clones_every_record_and_remaps_field_ids(client):
    headers, base, url, state, page = seed(client)
    field = page["definition"]["fields"][0]["id"]
    result = client.patch(
        url,
        headers=headers,
        json=mutation(
            state, upserts=[{"values": {field: f"Copy {i}"}} for i in range(100)]
        ),
    ).json()["data"]
    copied_block = {**result["block"], "id": "copy-block"}
    response = client.patch(
        base + "/blocks",
        headers=headers,
        json={
            "expected_version": result["content_version"],
            "upserts": [{k: v for k, v in copied_block.items() if k != "children"}],
            "moves": [
                {"id": "copy-block", "parent_id": None, "after_id": "table-block"}
            ],
        },
    )
    assert response.status_code == 200, response.text
    rewrites = response.json()["data"]["table_blocks"]
    assert len(rewrites) == 1
    copied_id = rewrites[0]["props"]["table_id"]
    assert copied_id != state["table_id"]
    page = client.get(
        base + "/tables/" + copied_id, headers=headers, params={"limit": 200}
    ).json()["data"]
    assert page["total"] == 100
    assert page["definition"]["fields"][0]["id"] != field
    assert sorted(
        row["values"][page["definition"]["fields"][0]["id"]] for row in page["records"]
    ) == sorted(f"Copy {i}" for i in range(100))
    assert page["records"][0]["id"] not in {
        row["id"] for row in client.get(url, headers=headers).json()["data"]["records"]
    }


def test_share_projection_and_release_snapshot_keep_private_fields_private(client):
    headers, base, url, state, page = seed(client)
    note = client.get(base, headers=headers).json()["data"]
    definition = page["definition"]
    title, status = definition["fields"][:2]
    definition["public_field_ids"] = [title["id"]]
    result = client.patch(
        url,
        headers=headers,
        json=mutation(
            state,
            definition=definition,
            upserts=[
                {
                    "values": {
                        title["id"]: "Public title",
                        status["id"]: status["options"][1]["id"],
                    }
                }
            ],
        ),
    )
    assert result.status_code == 200, result.text
    state = result.json()["data"]
    share = client.post(
        "/shares",
        headers=headers,
        json={
            "notebook_id": note["notebook_id"],
            "root_note_id": note["id"],
            "acknowledge_public_scope": True,
        },
    ).json()["data"]
    shared = client.get(
        f"/public/shares/{share['token']}/notes/{note['id']}/tables/{state['table_id']}"
    )
    assert shared.status_code == 200, shared.text
    assert status["id"] not in shared.text and "Public title" in shared.text
    raw = client.get(f"/public/shares/{share['token']}/notes/{note['id']}/content")
    assert "field_names" not in raw.text
    site = client.post(
        "/sites",
        headers=headers,
        json={
            "name": "Table site",
            "slug": "table-site",
            "navigation": [
                {
                    "note_id": note["id"],
                    "slug": "table",
                    "title": "Table",
                    "group": None,
                }
            ],
        },
    ).json()["data"]
    preview = client.get(f"/sites/{site['id']}/preview", headers=headers)
    assert preview.status_code == 200, preview.text
    published = client.post(f"/sites/{site['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    public = client.get("/public/sites/table-site")
    assert status["id"] not in public.text and state["table_id"] not in public.text
    assert "Public title" in public.text
    row = client.get(url, headers=headers).json()["data"]["records"][0]
    changed = client.patch(
        url,
        headers=headers,
        json=mutation(
            state, upserts=[{"id": row["id"], "values": {title["id"]: "Next release"}}]
        ),
    )
    assert changed.status_code == 200
    assert "Next release" not in client.get("/public/sites/table-site").text
    assert (
        "Next release"
        in client.get(f"/sites/{site['id']}/preview", headers=headers).text
    )
    assert "Public title" in client.get("/s/table-site/table").text
    markdown = client.get(base + "/markdown", headers=headers)
    assert markdown.status_code == 200 and "Next release" in markdown.text


def test_published_table_pages_are_bounded_and_revoked_with_the_release(client):
    headers, base, url, state, page = seed(client)
    field = page["definition"]["fields"][0]["id"]
    for batch in range(3):
        state = client.patch(
            url,
            headers=headers,
            json=mutation(
                state,
                upserts=[
                    {"values": {field: f"Frozen row {batch * 100 + index:03}"}}
                    for index in range(100)
                ],
            ),
        ).json()["data"]
    note = client.get(base, headers=headers).json()["data"]
    site = client.post(
        "/sites",
        headers=headers,
        json={
            "name": "Paged table",
            "slug": "paged-table",
            "navigation": [
                {
                    "note_id": note["id"],
                    "slug": "records",
                    "title": "Records",
                    "group": None,
                }
            ],
        },
    ).json()["data"]
    release = client.post(f"/sites/{site['id']}/publish", headers=headers)
    assert release.status_code == 200, release.text
    public = client.get("/public/sites/paged-table").json()["data"]
    snapshot = public["pages"][0]["blocks"]["blocks"][0]["table_snapshot"]
    assert snapshot["total"] == 300 and len(snapshot["rows"]) == 100
    next_page = client.get(snapshot["records_url"] + "&offset=100&limit=40")
    assert next_page.status_code == 200, next_page.text
    assert len(next_page.json()["data"]["rows"]) == 40
    assert next_page.json()["data"]["total"] == 300
    html = client.get("/s/paged-table/records")
    assert "继续阅读表格" in html.text
    markdown = client.get("/s/paged-table/pages/records.md")
    assert markdown.status_code == 200, markdown.text
    assert markdown.text.count("Frozen row ") == 300
    assert (
        client.post(f"/sites/{site['id']}/unpublish", headers=headers).status_code
        == 200
    )
    assert client.get(snapshot["records_url"]).status_code == 404


def test_copy_leaves_uuid_shaped_authored_text_unchanged(client):
    headers, base, url, state, page = seed(client)
    field = page["definition"]["fields"][0]["id"]
    state = client.patch(
        url, headers=headers, json=mutation(state, upserts=[{"values": {field: field}}])
    ).json()["data"]
    block = {**state["block"], "id": "literal-copy"}
    response = client.patch(
        base + "/blocks",
        headers=headers,
        json={
            "expected_version": state["content_version"],
            "upserts": [{k: v for k, v in block.items() if k != "children"}],
            "moves": [
                {"id": "literal-copy", "parent_id": None, "after_id": "table-block"}
            ],
        },
    )
    assert response.status_code == 200, response.text
    copied_id = response.json()["data"]["table_blocks"][0]["props"]["table_id"]
    copied = client.get(base + "/tables/" + copied_id, headers=headers).json()["data"]
    assert (
        copied["records"][0]["values"][copied["definition"]["fields"][0]["id"]] == field
    )


def test_table_access_is_bound_to_note_and_current_workspace_role(client):
    from uuid import UUID
    from sqlalchemy import select
    from orbis_user_api.models.workspace import WorkspaceMember

    headers, base, url, state, _ = seed(client)
    assert (
        client.get(url.replace(base, f"/notes/{uuid4()}"), headers=headers).status_code
        == 404
    )
    note = client.get(base, headers=headers).json()["data"]

    async def make_read_only():
        async with client.app.state.session_factory() as session:
            membership = await session.scalar(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == UUID(note["workspace_id"])
                )
            )
            membership.role = "normal"
            await session.commit()

    client.portal.call(make_read_only)
    assert client.get(url, headers=headers).status_code == 200
    assert (
        client.patch(
            url, headers=headers, json=mutation(state, upserts=[{"values": {}}])
        ).status_code
        == 403
    )
    assert (
        client.post(
            base + "/tables",
            headers=headers,
            json={
                "operation_id": str(uuid4()),
                "expected_document_version": state["content_version"],
                "block_id": "table-block",
            },
        ).status_code
        == 403
    )


def test_all_field_types_validate_and_hidden_field_values_do_not_break_undo(client):
    headers, _, url, state, page = seed(client)
    definition = page["definition"]
    fields = [
        {"id": str(uuid4()), "name": "Amount", "kind": "number", "options": []},
        {
            "id": str(uuid4()),
            "name": "Tags",
            "kind": "multi_select",
            "options": [{"id": str(uuid4()), "label": "Tag", "color": "blue"}],
        },
        {"id": str(uuid4()), "name": "Done", "kind": "checkbox", "options": []},
        {"id": str(uuid4()), "name": "URL", "kind": "url", "options": []},
    ]
    definition["fields"].extend(fields)
    state = client.patch(
        url, headers=headers, json=mutation(state, definition=definition)
    ).json()["data"]
    values = {
        fields[0]["id"]: 1.5,
        fields[1]["id"]: [fields[1]["options"][0]["id"]],
        fields[2]["id"]: True,
        fields[3]["id"]: "https://example.com",
    }
    response = client.patch(
        url, headers=headers, json=mutation(state, upserts=[{"values": values}])
    )
    assert response.status_code == 200, response.text
    state = response.json()["data"]
    for key, value in [
        (fields[0]["id"], True),
        (fields[1]["id"], ["invalid"]),
        (fields[2]["id"], "true"),
        (fields[3]["id"], "http://["),
    ]:
        invalid = client.patch(
            url,
            headers=headers,
            json=mutation(state, upserts=[{"values": {key: value}}]),
        )
        assert invalid.status_code == 422, invalid.text
    record = client.get(url, headers=headers).json()["data"]["records"][0]
    definition["fields"] = [
        field for field in definition["fields"] if field["id"] != fields[0]["id"]
    ]
    state = client.patch(
        url, headers=headers, json=mutation(state, definition=definition)
    ).json()["data"]
    changed = client.patch(
        url,
        headers=headers,
        json=mutation(
            state, upserts=[{"id": record["id"], "values": {fields[2]["id"]: False}}]
        ),
    ).json()["data"]
    restored = client.patch(
        url, headers=headers, json=mutation(changed, **changed["inverse"])
    )
    assert restored.status_code == 200, restored.text
