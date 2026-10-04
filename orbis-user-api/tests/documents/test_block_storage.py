from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from orbis_user_api.models.note_block import (
    NoteBlockDocument,
    NoteBlockSnapshot,
    NoteBlockVersion,
)
from sqlalchemy import event, select

from .test_content_pages import seed


def live_rows(client, note_id):
    async def read():
        async with client.app.state.session_factory() as session:
            rows = list(
                await session.scalars(
                    select(NoteBlockVersion).where(
                        NoteBlockVersion.note_id == UUID(note_id)
                    )
                )
            )
            return [
                {
                    "id": row.id,
                    "block_id": row.block_id,
                    "parent_id": row.parent_id,
                    "payload": row.payload,
                    "from": row.valid_from,
                    "to": row.valid_to,
                }
                for row in rows
            ]

    return client.portal.call(read)


def test_page_reads_block_rows_without_selecting_the_legacy_document(client):
    note_id, headers, original = seed(client)
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get(
            f"/notes/{note_id}/content", headers=headers, params={"limit": 32}
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    assert response.json()["data"]["blocks"]["blocks"] == original[:32]
    assert response.json()["data"]["storage_format"] == "blocks"
    assert not any(
        "note_contents.blocks" in query
        or "note_revisions.blocks" in query
        or "json_each" in query
        for query in statements
    )
    assert any("note_block_versions.parent_id IN" in query for query in statements)
    assert all("children" not in row["payload"] for row in live_rows(client, note_id))


def test_one_block_edit_writes_one_block_version_and_reuses_the_unloaded_tail(client):
    note_id, headers, original = seed(client)
    before = live_rows(client, note_id)
    payload = {**original[7], "content": [{"type": "text", "text": "Sparse edit"}]}
    payload.pop("children")
    response = client.patch(
        f"/notes/{note_id}/blocks",
        headers=headers,
        json={"expected_version": 2, "upserts": [payload]},
    )
    assert response.status_code == 200
    assert "blocks" not in response.json()["data"]
    after = live_rows(client, note_id)
    assert len(after) == len(before) + 1
    closed = [row for row in after if row["to"] == 3]
    assert [row["block_id"] for row in closed] == [original[7]["id"]]
    tail_before = {row["id"] for row in before if row["block_id"] == original[-1]["id"]}
    assert {
        row["id"] for row in after if row["block_id"] == original[-1]["id"]
    } == tail_before
    old = client.get(
        f"/notes/{note_id}/content",
        headers=headers,
        params={"offset": 0, "limit": 32, "expected_version": 2},
    ).json()["data"]
    assert old["blocks"]["blocks"][7] == original[7]
    new = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert new["blocks"]["blocks"][7]["content"][0]["text"] == "Sparse edit"
    assert new["blocks"]["blocks"][32:] == original[32:]

    async def history():
        from orbis_user_api.models.collaboration import NoteRevision

        async with client.app.state.session_factory() as session:
            return (
                await session.scalar(
                    select(NoteRevision).where(
                        NoteRevision.note_id == UUID(note_id),
                        NoteRevision.content_version == 3,
                    )
                )
            ).blocks

    assert client.portal.call(history) == {}
    assert (
        client.get("/search", headers=headers, params={"q": "Sparse edit"}).json()[
            "data"
        ]["pagination"]["total"]
        == 1
    )


def test_nested_child_can_move_out_before_its_parent_is_deleted(client):
    child = {
        "id": "child",
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": "Keep me"}],
        "children": [],
    }
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [child],
    }
    sibling = {**child, "id": "sibling"}
    note_id, headers, _ = seed(client, [parent, sibling])
    response = client.patch(
        f"/notes/{note_id}/blocks",
        headers=headers,
        json={
            "expected_version": 2,
            "moves": [{"id": "child", "parent_id": None, "after_id": None}],
            "deletes": ["parent"],
        },
    )
    assert response.status_code == 200
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert [block["id"] for block in full["blocks"]["blocks"]] == ["child", "sibling"]
    assert full["content_version"] == 3


def test_invalid_structure_rolls_back_the_claimed_version(client):
    child = {
        "id": "child",
        "type": "paragraph",
        "props": {},
        "content": [],
        "children": [],
    }
    note_id, headers, _ = seed(client, [{**child, "id": "parent", "children": [child]}])
    for moves in [
        [{"id": "parent", "parent_id": "child"}],
        [{"id": "child", "parent_id": "missing"}],
    ]:
        response = client.patch(
            f"/notes/{note_id}/blocks",
            headers=headers,
            json={"expected_version": 2, "moves": moves},
        )
        assert response.status_code == 422
        assert (
            client.get(f"/notes/{note_id}/content", headers=headers).json()["data"][
                "content_version"
            ]
            == 2
        )


def test_two_writers_with_the_same_version_have_one_winner(client):
    note_id, headers, original = seed(client)

    def save(index):
        payload = {
            **original[index],
            "content": [{"type": "text", "text": f"Writer {index}"}],
        }
        payload.pop("children")
        return client.patch(
            f"/notes/{note_id}/blocks",
            headers=headers,
            json={"expected_version": 2, "upserts": [payload]},
        )

    before = len(live_rows(client, note_id))
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, [0, 1]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert len(live_rows(client, note_id)) == before + 1
    assert (
        client.get(f"/notes/{note_id}/content", headers=headers).json()["data"][
            "content_version"
        ]
        == 3
    )


def test_migration_is_idempotent_and_leaves_the_legacy_backup_untouched(client):
    note_id, headers, original = seed(client)

    async def migrate_legacy():
        from orbis_user_api.application.block_content import BlockContentStore
        from orbis_user_api.models.note import Note, NoteContent
        from sqlalchemy import delete

        async with client.app.state.session_factory() as session:
            for model in [NoteBlockVersion, NoteBlockSnapshot, NoteBlockDocument]:
                await session.execute(
                    delete(model).where(model.note_id == UUID(note_id))
                )
            legacy = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(note_id))
            )
            legacy.blocks = {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": original,
            }
            legacy.content_version = 8
            await session.commit()
            note = await session.get(Note, UUID(note_id))
            await BlockContentStore(session, note).activate()
            await session.commit()
            first = list(
                await session.scalars(
                    select(NoteBlockVersion.id).where(
                        NoteBlockVersion.note_id == UUID(note_id)
                    )
                )
            )
            await BlockContentStore(session, note).activate()
            await session.commit()
            second = list(
                await session.scalars(
                    select(NoteBlockVersion.id).where(
                        NoteBlockVersion.note_id == UUID(note_id)
                    )
                )
            )
            assert first == second
            assert legacy.blocks["blocks"] == original and legacy.content_version == 8

    client.portal.call(migrate_legacy)
    full = client.get(f"/notes/{note_id}/content", headers=headers).json()["data"]
    assert full["content_version"] == 8 and full["blocks"]["blocks"] == original
