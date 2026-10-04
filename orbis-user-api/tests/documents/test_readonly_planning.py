from uuid import UUID

import pytest
from sqlalchemy import event, select

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.user import User
from orbis_user_api.services.exceptions import NoteContentInvalid

from .test_bounded_blocks import demote_to_legacy, paragraph
from .test_content_pages import seed


@pytest.mark.parametrize("legacy", [False, True])
def test_preview_uses_identical_tree_validation_without_database_writes(client, legacy):
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph("child"), paragraph("keep")],
    }
    note_id, headers, original = seed(client, [parent, paragraph("tail")])
    if legacy:
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

        async def preview():
            async with client.app.state.session_factory() as session:
                note = await session.get(Note, UUID(note_id))
                store = BlockContentStore(session, note)
                result = await store.preview_changes(
                    2,
                    [],
                    [{"id": "child", "parent_id": None, "after_id": None}],
                    ["parent"],
                )
                assert result["content_version"] == 3 and result["total_blocks"] == 2
                with pytest.raises(NoteContentInvalid):
                    await store.preview_changes(
                        2,
                        [],
                        [{"id": "parent", "parent_id": "child", "after_id": None}],
                        [],
                    )
                await session.commit()

        client.portal.call(preview)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert not any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
    read = client.get(f"/notes/{note_id}/content/children", headers=headers).json()[
        "data"
    ]
    assert read["content_version"] == 2 and read["total_blocks"] == 2
    assert read["descriptors"][0]["child_count"] == 2
    if legacy:
        assert read["storage_format"] == "legacy"


def test_touch_note_false_allows_outer_metadata_cas_without_dirty_note(client):
    note_id, _headers, original = seed(client, [paragraph("block")])

    async def stage():
        async with client.app.state.session_factory() as session:
            note = await session.get(Note, UUID(note_id))
            user = await session.get(User, note.owner_id)
            before = note.updated_at_ms
            shallow = {
                key: value for key, value in original[0].items() if key != "children"
            }
            shallow["content"] = [{"type": "text", "text": "Staged"}]
            result = await BlockContentStore(session, note).changes(
                2, [shallow], [], [], user, commit=False, touch_note=False
            )
            actual = await session.scalar(
                select(Note.updated_at_ms).where(Note.id == note.id)
            )
            assert actual == before and note not in session.dirty
            assert result["content_version"] == 3
            await session.rollback()

    client.portal.call(stage)


def test_note_stamp_is_monotonic_even_with_frozen_clock(client, monkeypatch):
    note_id, _headers, original = seed(client, [paragraph("block")])
    monkeypatch.setattr("orbis_user_api.application.block_content.now_ms", lambda: 1)

    async def write():
        async with client.app.state.session_factory() as session:
            note = await session.get(Note, UUID(note_id))
            user = await session.get(User, note.owner_id)
            stamp = note.updated_at_ms
            shallow = {
                key: value for key, value in original[0].items() if key != "children"
            }
            result = await BlockContentStore(session, note).changes(
                2, [shallow], [], [], user
            )
            assert result["updated_at_ms"] == stamp + 1
            assert note.updated_at_ms == stamp + 1

    client.portal.call(write)


def test_historical_json_reads_do_not_hydrate_or_commit_any_block_rows(client):
    note_id, _headers, original = seed(client, [paragraph("block")])
    historical = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [{**paragraph("old"), "type": "heading", "props": {"level": 2}}],
    }

    demote_to_legacy(
        client,
        note_id,
        {"schema_version": 2, "editor": "blocknote", "blocks": original},
    )

    async def add_history():
        async with client.app.state.session_factory() as session:
            # Simulate a real first migration at version 8, leaving old version
            # 2 as immutable JSON history rather than native block intervals.
            legacy = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(note_id))
            )
            legacy.content_version = 8
            revision = await session.scalar(
                select(NoteRevision).where(
                    NoteRevision.note_id == UUID(note_id),
                    NoteRevision.content_version == 2,
                )
            )
            revision.blocks = historical
            revision.plain_text = derive_plain_text(historical)
            note = await session.get(Note, UUID(note_id))
            await BlockContentStore(session, note).activate()
            await session.commit()

    client.portal.call(add_history)
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:

        async def read():
            async with client.app.state.session_factory() as session:
                note = await session.get(Note, UUID(note_id))
                store = BlockContentStore(session, note)
                full = await store.full(2)
                assert full.blocks == historical
                assert (await store.page(0, 32, 2))["blocks"]["blocks"][0][
                    "id"
                ] == "old"
                assert (await store.children(version=2))["blocks"]["blocks"][0][
                    "id"
                ] == "old"
                assert (await store.block("old", 2))["block_revision"] == 2
                assert (await store.outline(2))["items"][0]["id"] == "old"
                assert (await store.changed_blocks(2, target_version=8))["items"]
                await session.commit()

        client.portal.call(read)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert not any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
