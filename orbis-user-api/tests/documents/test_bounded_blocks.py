from uuid import UUID

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.note_block import (
    NoteBlockDocument,
    NoteBlockSnapshot,
    NoteBlockVersion,
)
from orbis_user_api.models.user import User
from sqlalchemy import delete, event, select

from .test_block_storage import live_rows
from .test_content_pages import seed


def paragraph(identifier, text="Body"):
    return {
        "id": identifier,
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": text}],
        "children": [],
    }


def test_large_container_only_loads_direct_children_and_shallow_edit_keeps_descendants(
    client,
):
    parent = {
        "id": "container",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph(f"child-{index}") for index in range(1000)],
    }
    note_id, headers, _ = seed(client, [parent])
    url = f"/notes/{note_id}/content/children"
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    page = response.json()["data"]
    assert len(response.content) < 4096
    assert page["blocks"]["blocks"][0]["children"] == []
    assert page["descriptors"][0]["child_count"] == 1000
    assert page["descriptors"][0]["children_loaded"] is False
    children = client.get(
        url,
        headers=headers,
        params={"parent_id": "container", "limit": 16, "expected_version": 2},
    ).json()["data"]
    assert children["next_offset"] == 16 and children["total_blocks"] == 1000
    assert len(children["blocks"]["blocks"]) == 16
    before = live_rows(client, note_id)
    updated = {key: value for key, value in parent.items() if key != "children"}
    updated["props"] = {"textColor": "blue"}
    saved = client.patch(
        f"/notes/{note_id}/blocks",
        headers=headers,
        json={"expected_version": 2, "upserts": [updated]},
    )
    assert saved.status_code == 200, saved.text
    after = live_rows(client, note_id)
    assert len(after) == len(before) + 1
    assert {row["id"] for row in before if row["block_id"] != "container"} == {
        row["id"] for row in after if row["block_id"] != "container"
    }


def test_oversized_own_payload_stays_unloaded_and_first_response_is_bounded(client):
    note_id, headers, _ = seed(
        client, [paragraph("giant", "x" * 300_000), paragraph("small")]
    )
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, params, _context, _many):
        statements.append((statement, params))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get(
            f"/notes/{note_id}/content/children",
            headers=headers,
            params={"max_bytes": 4096},
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    page = response.json()["data"]
    assert len(response.content) <= 4096
    assert page["descriptors"][0]["payload_loaded"] is False
    assert page["descriptors"][0]["payload_bytes"] > 300_000
    assert page["blocks"]["blocks"][0]["content"] == []
    assert page["next_offset"] >= 1
    assert not any(
        "SELECT note_block_versions.payload \n" in sql and "giant" in params
        for sql, params in statements
    )
    exact = client.get(f"/notes/{note_id}/blocks/giant", headers=headers).json()["data"]
    assert exact["descriptor"]["payload_loaded"] is True
    assert len(exact["block"]["content"][0]["text"]) == 300_000


def test_structure_move_reads_neighbors_not_a_full_manifest_and_history_stays_fixed(
    client,
):
    note_id, headers, original = seed(
        client, [paragraph(f"block-{index}") for index in range(1000)]
    )
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.patch(
            f"/notes/{note_id}/blocks",
            headers=headers,
            json={
                "expected_version": 2,
                "moves": [
                    {"id": "block-999", "parent_id": None, "after_id": "block-0"}
                ],
            },
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    metadata_queries = [
        sql
        for sql in statements
        if sql.startswith("SELECT") and "FROM note_block_versions" in sql
    ]
    assert metadata_queries
    assert all(
        "block_id IN" in sql or " LIMIT " in sql or "\n LIMIT " in sql
        for sql in metadata_queries
    )
    assert len(metadata_queries) <= 6
    old = client.get(
        f"/notes/{note_id}/content/children",
        headers=headers,
        params={"offset": 995, "limit": 5, "expected_version": 2},
    ).json()["data"]
    assert [block["id"] for block in old["blocks"]["blocks"]] == [
        block["id"] for block in original[-5:]
    ]
    new = client.get(f"/notes/{note_id}/content/children", headers=headers).json()[
        "data"
    ]
    assert [block["id"] for block in new["blocks"]["blocks"]][:3] == [
        "block-0",
        "block-999",
        "block-1",
    ]


def test_type_change_checks_unloaded_children(client):
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph("child")],
    }
    note_id, headers, _ = seed(client, [parent])
    response = client.patch(
        f"/notes/{note_id}/blocks",
        headers=headers,
        json={
            "expected_version": 2,
            "upserts": [{"id": "parent", "type": "steps", "props": {}, "content": []}],
        },
    )
    assert response.status_code == 422
    assert (
        client.get(f"/notes/{note_id}/content/children", headers=headers).json()[
            "data"
        ]["content_version"]
        == 2
    )


def test_staged_mutation_rolls_back_with_its_outer_transaction(client):
    note_id, headers, _ = seed(client, [paragraph("block")])

    async def stage_and_abort():
        async with client.app.state.session_factory() as session:
            note = await session.get(Note, UUID(note_id))
            user = await session.get(User, note.owner_id)
            result = await BlockContentStore(session, note).changes(
                2,
                [
                    {
                        key: value
                        for key, value in paragraph("block", "Staged").items()
                        if key != "children"
                    }
                ],
                [],
                [],
                user,
                commit=False,
            )
            assert result["content_version"] == 3
            await session.rollback()

    client.portal.call(stage_and_abort)
    page = client.get(f"/notes/{note_id}/content/children", headers=headers).json()[
        "data"
    ]
    assert page["content_version"] == 2
    assert page["blocks"]["blocks"][0]["content"][0]["text"] == "Body"


def demote_to_legacy(client, note_id, blocks):
    async def demote():
        async with client.app.state.session_factory() as session:
            for model in [NoteBlockVersion, NoteBlockSnapshot, NoteBlockDocument]:
                await session.execute(
                    delete(model).where(model.note_id == UUID(note_id))
                )
            record = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(note_id))
            )
            record.blocks = blocks
            record.content_version = 2
            await session.commit()

    client.portal.call(demote)


def test_legacy_bounded_read_strips_subtrees_in_sql_and_does_not_activate(client):
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph(f"child-{index}") for index in range(1000)],
    }
    note_id, headers, original = seed(client, [parent])
    demote_to_legacy(
        client,
        note_id,
        {"schema_version": 2, "editor": "blocknote", "blocks": original},
    )
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        roots = client.get(f"/notes/{note_id}/content/children", headers=headers)
        children = client.get(
            f"/notes/{note_id}/content/children",
            headers=headers,
            params={"parent_id": "parent", "limit": 8},
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert roots.status_code == children.status_code == 200, children.text
    assert roots.json()["data"]["storage_format"] == "legacy"
    assert roots.json()["data"]["descriptors"][0]["child_count"] == 1000
    assert len(roots.content) < 4096
    assert len(children.json()["data"]["blocks"]["blocks"]) == 8
    assert not any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
    assert not any("SELECT note_contents.blocks," in sql for sql in statements)
    exact = client.get(f"/notes/{note_id}/blocks/child-50", headers=headers).json()[
        "data"
    ]
    assert exact["block"]["id"] == "child-50"
    assert exact["descriptor"]["parent_id"] == "parent"
    leaf = client.get(
        f"/notes/{note_id}/content/children",
        headers=headers,
        params={"parent_id": "child-50"},
    )
    assert leaf.status_code == 200 and leaf.json()["data"]["total_blocks"] == 0
    assert (
        client.get(
            f"/notes/{note_id}/content/children",
            headers=headers,
            params={"parent_id": "missing"},
        ).status_code
        == 422
    )


def test_change_feed_has_stable_target_and_tombstones(client):
    note_id, headers, _ = seed(
        client, [paragraph("one"), paragraph("two"), paragraph("three")]
    )
    response = client.patch(
        f"/notes/{note_id}/blocks",
        headers=headers,
        json={
            "expected_version": 2,
            "upserts": [
                {
                    key: value
                    for key, value in paragraph("one", "Edited").items()
                    if key != "children"
                }
            ],
            "deletes": ["two"],
        },
    )
    assert response.status_code == 200

    async def read():
        async with client.app.state.session_factory() as session:
            note = await session.get(Note, UUID(note_id))
            return await BlockContentStore(session, note).changed_blocks(
                2, limit=1, target_version=3
            )

    first = client.portal.call(read)
    assert first["items"] == [{"id": "one", "change": "upsert", "block_revision": 3}]
    assert first["has_more"]
    assert (
        client.patch(
            f"/notes/{note_id}/blocks",
            headers=headers,
            json={"expected_version": 3, "deletes": ["three"]},
        ).status_code
        == 200
    )

    async def second_read():
        async with client.app.state.session_factory() as session:
            note = await session.get(Note, UUID(note_id))
            return await BlockContentStore(session, note).changed_blocks(
                2, offset=1, target_version=3
            )

    second = client.portal.call(second_read)
    assert second["content_version"] == 3
    assert second["items"] == [{"id": "two", "change": "deleted", "block_revision": 3}]


def test_exhausted_insert_gap_only_rebalances_a_local_window(client):
    note_id, headers, _ = seed(
        client, [paragraph(f"original-{index}") for index in range(1000)]
    )
    before = live_rows(client, note_id)
    version = 2
    for index in range(35):
        response = client.patch(
            f"/notes/{note_id}/blocks",
            headers=headers,
            json={
                "expected_version": version,
                "upserts": [
                    {
                        key: value
                        for key, value in paragraph(f"inserted-{index}").items()
                        if key != "children"
                    }
                ],
                "moves": [
                    {"id": f"inserted-{index}", "parent_id": None, "after_id": None}
                ],
            },
        )
        assert response.status_code == 200, response.text
        version = response.json()["data"]["content_version"]
    after = live_rows(client, note_id)
    assert len(after) <= len(before) + 35 + 128
    assert {row["id"] for row in before if row["block_id"] == "original-999"} == {
        row["id"] for row in after if row["block_id"] == "original-999"
    }
    page = client.get(f"/notes/{note_id}/content/children", headers=headers).json()[
        "data"
    ]
    assert page["total_blocks"] == 1035
    assert [row["id"] for row in page["blocks"]["blocks"]][:2] == [
        "inserted-34",
        "inserted-33",
    ]
