"""PostgreSQL evidence for real sparse writes, long history and bounded reads."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from time import perf_counter
from uuid import UUID

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.note_block import NoteBlockVersion as Block
from sqlalchemy import event, insert, select, text
from test_postgres_base_mvp import postgres_client as postgres_fixture
from test_postgres_base_mvp import request_data, setup_document

postgres_client = postgres_fixture


def paragraph(identifier, value="Text"):
    return {
        "id": identifier,
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": value}],
        "children": [],
    }


def test_postgres_1k_10k_30k_sparse_content_and_history_indexes(postgres_client):
    client = postgres_client
    headers, note = setup_document(client)
    path = f"/notes/{note['id']}/content"
    version = 1
    durations = []
    for count in [1000, 10000, 30000]:
        started = perf_counter()
        saved = request_data(
            client,
            "PUT",
            path,
            headers=headers,
            json={
                "expected_version": version,
                "blocks": {
                    "schema_version": 2,
                    "editor": "blocknote",
                    "blocks": [paragraph(f"block-{index}") for index in range(count)],
                },
            },
        )
        version = saved["content_version"]
        import_seconds = perf_counter() - started
        started = perf_counter()
        page = request_data(
            client, "GET", f"{path}/children", headers=headers, params={"limit": 32}
        )
        read_seconds = perf_counter() - started
        assert page["total_blocks"] == count
        assert len(page["blocks"]["blocks"]) == 32
        assert page["descriptors"][0]["payload_loaded"] is True
        statements = []
        engine = client.app.state.engine.sync_engine

        def capture(
            _conn, _cursor, statement, _params, _context, _many, statements=statements
        ):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture)
        started = perf_counter()
        try:
            saved = request_data(
                client,
                "PATCH",
                f"/notes/{note['id']}/blocks",
                headers=headers,
                json={
                    "expected_version": version,
                    "upserts": [
                        {
                            key: value
                            for key, value in paragraph(
                                "block-10", f"Sparse {count}"
                            ).items()
                            if key != "children"
                        }
                    ],
                    "moves": [
                        {
                            "id": f"block-{count - 1}",
                            "parent_id": None,
                            "after_id": "block-1",
                        }
                    ],
                },
            )
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        write_seconds = perf_counter() - started
        version = saved["content_version"]
        metadata_queries = [
            sql
            for sql in statements
            if sql.startswith("SELECT") and "FROM note_block_versions" in sql
        ]
        assert all("block_id IN" in sql or "LIMIT" in sql for sql in metadata_queries)
        assert len(metadata_queries) <= 7
        assert not any(
            "note_contents.blocks" in sql or "note_revisions.blocks" in sql
            for sql in statements
        )
        durations.append(
            {
                "blocks": count,
                "import_seconds": round(import_seconds, 3),
                "read_seconds": round(read_seconds, 4),
                "write_seconds": round(write_seconds, 4),
                "metadata_queries": len(metadata_queries),
            }
        )

    async def verify_history_plan():
        async with client.app.state.session_factory() as session:
            historical = []
            for index in range(40000):
                historical.append(
                    {
                        "id": new_uuidv7(),
                        "note_id": UUID(note["id"]),
                        "block_id": f"historical-{index}",
                        "parent_id": None,
                        "position": index,
                        "block_type": "paragraph",
                        "payload": {
                            "id": f"historical-{index}",
                            "type": "paragraph",
                            "props": {},
                            "content": [],
                        },
                        "plain_text": "",
                        "payload_bytes": 96,
                        "valid_from": 1,
                        "valid_to": 2,
                    }
                )
            await session.execute(insert(Block), historical)
            await session.commit()
            await session.execute(text("ANALYZE note_block_versions"))
            plans = []
            for sql in [
                "SELECT block_id,position FROM note_block_versions WHERE note_id=:note AND valid_to IS NULL AND parent_id IS NULL ORDER BY position,block_id LIMIT 32",
                "SELECT block_id,parent_id,position FROM note_block_versions WHERE note_id=:note AND block_id='block-10' AND valid_to IS NULL",
            ]:
                rows = (
                    (
                        await session.execute(
                            text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql),
                            {"note": UUID(note["id"])},
                        )
                    )
                    .scalars()
                    .all()
                )
                plans.append(rows[0][0])
            return plans

    plans = client.portal.call(verify_history_plan)

    def index_names(node):
        return ([node["Index Name"]] if "Index Name" in node else []) + [
            name for child in node.get("Plans", []) for name in index_names(child)
        ]

    print(
        {
            "postgres_document_benchmark": durations,
            "current_sibling_plan": plans[0],
            "current_identity_plan": plans[1],
        }
    )
    assert "ix_note_blocks_current_roots" in index_names(plans[0]["Plan"])
    assert "ix_note_blocks_current_identity" in index_names(plans[1]["Plan"])


def test_postgres_large_nested_container_and_concurrent_block_changes(postgres_client):
    client = postgres_client
    headers, note = setup_document(client)
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph(f"child-{index}") for index in range(10000)],
    }
    request_data(
        client,
        "PUT",
        f"/notes/{note['id']}/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": [parent]},
        },
    )
    root = client.get(f"/notes/{note['id']}/content/children", headers=headers)
    assert root.status_code == 200
    assert len(root.content) < 4096
    assert root.json()["data"]["descriptors"][0]["child_count"] == 10000
    child_page = request_data(
        client,
        "GET",
        f"/notes/{note['id']}/content/children",
        headers=headers,
        params={"parent_id": "parent", "limit": 32, "expected_version": 2},
    )
    assert len(child_page["blocks"]["blocks"]) == 32

    def write(index):
        return client.patch(
            f"/notes/{note['id']}/blocks",
            headers=headers,
            json={
                "expected_version": 2,
                "upserts": [
                    {
                        key: value
                        for key, value in paragraph(
                            f"child-{index}", "Concurrent"
                        ).items()
                        if key != "children"
                    }
                ],
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(write, [0, 1]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    old = request_data(
        client,
        "GET",
        f"/notes/{note['id']}/content/children",
        headers=headers,
        params={"parent_id": "parent", "offset": 0, "limit": 2, "expected_version": 2},
    )
    assert [row["content"][0]["text"] for row in old["blocks"]["blocks"]] == [
        "Text",
        "Text",
    ]

    async def count_current():
        from sqlalchemy import func

        async with client.app.state.session_factory() as session:
            return await session.scalar(
                select(func.count())
                .select_from(Block)
                .where(Block.note_id == UUID(note["id"]), Block.valid_to.is_(None))
            )

    assert client.portal.call(count_current) == 10001


def test_postgres_legacy_json_fallback_has_bounded_nesting_without_activation(
    postgres_client,
):
    client = postgres_client
    headers, note = setup_document(client)
    parent = {
        "id": "parent",
        "type": "quote",
        "props": {},
        "content": [],
        "children": [paragraph(f"child-{index}") for index in range(1000)],
    }
    source = {"schema_version": 2, "editor": "blocknote", "blocks": [parent]}
    request_data(
        client,
        "PUT",
        f"/notes/{note['id']}/content",
        headers=headers,
        json={"expected_version": 1, "blocks": source},
    )

    async def demote():
        from orbis_user_api.models.note import NoteContent
        from orbis_user_api.models.note_block import (
            NoteBlockDocument,
            NoteBlockSnapshot,
        )
        from sqlalchemy import delete

        async with client.app.state.session_factory() as session:
            for model in [Block, NoteBlockSnapshot, NoteBlockDocument]:
                await session.execute(
                    delete(model).where(model.note_id == UUID(note["id"]))
                )
            old = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == UUID(note["id"]))
            )
            old.blocks = source
            old.content_version = 2
            await session.commit()

    client.portal.call(demote)
    root = client.get(f"/notes/{note['id']}/content/children", headers=headers)
    assert root.status_code == 200, root.text
    assert len(root.content) < 4096
    assert root.json()["data"]["descriptors"][0]["child_count"] == 1000
    children = client.get(
        f"/notes/{note['id']}/content/children",
        headers=headers,
        params={"parent_id": "parent", "limit": 8},
    )
    assert children.status_code == 200, children.text
    assert len(children.json()["data"]["blocks"]["blocks"]) == 8
    exact = client.get(f"/notes/{note['id']}/blocks/child-50", headers=headers)
    assert exact.status_code == 200, exact.text
    assert exact.json()["data"]["descriptor"]["parent_id"] == "parent"
    leaf = client.get(
        f"/notes/{note['id']}/content/children",
        headers=headers,
        params={"parent_id": "child-50"},
    )
    assert leaf.status_code == 200 and leaf.json()["data"]["total_blocks"] == 0
    assert (
        client.get(
            f"/notes/{note['id']}/content/children",
            headers=headers,
            params={"parent_id": "missing"},
        ).status_code
        == 422
    )

    async def migrate_and_verify():
        from orbis_user_api.tools.migrate_note_blocks import backfill

        settings = client.app.state.settings
        arguments = {
            "database_schema": settings.database_schema,
            "note_ids": [UUID(note["id"])],
        }
        assert await backfill(settings.database_url, apply=False, **arguments) == 1
        assert await backfill(settings.database_url, apply=True, **arguments) == 1
        assert await backfill(settings.database_url, apply=True, **arguments) == 0

    client.portal.call(migrate_and_verify)
    migrated = request_data(
        client, "GET", f"/notes/{note['id']}/content/children", headers=headers
    )
    assert migrated["storage_format"] == "blocks" and migrated["content_version"] == 2


def test_postgres_page_snapshot_stays_stable_during_a_concurrent_save(
    postgres_client, monkeypatch
):
    import asyncio

    from orbis_user_api.application.block_content import BlockContentStore
    from orbis_user_api.models.note import Note
    from orbis_user_api.models.user import User
    from sqlalchemy.ext.asyncio import AsyncSession

    client = postgres_client
    headers, note = setup_document(client)
    request_data(
        client,
        "PUT",
        f"/notes/{note['id']}/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [paragraph("block", "Original")],
            },
        },
    )
    original_execute = AsyncSession.execute

    async def run_race():
        ready, continue_read = asyncio.Event(), asyncio.Event()
        reader_session = None
        paused = False

        async def pause_metadata(self, statement, *args, **kwargs):
            nonlocal paused
            descriptions = getattr(statement, "column_descriptions", [])
            if (
                self is reader_session
                and not paused
                and descriptions
                and descriptions[0].get("name") == "block_id"
            ):
                paused = True
                ready.set()
                await asyncio.wait_for(continue_read.wait(), timeout=10)
            return await original_execute(self, statement, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "execute", pause_metadata)

        async def read():
            nonlocal reader_session
            async with client.app.state.session_factory() as session:
                reader_session = session
                stored = await session.get(Note, UUID(note["id"]))
                return await BlockContentStore(session, stored).children()

        async def save():
            async with client.app.state.session_factory() as session:
                stored = await session.get(Note, UUID(note["id"]))
                user = await session.get(User, stored.owner_id)
                return await BlockContentStore(session, stored).changes(
                    2,
                    [
                        {
                            key: value
                            for key, value in paragraph("block", "New").items()
                            if key != "children"
                        }
                    ],
                    [],
                    [],
                    user,
                )

        reading = asyncio.create_task(read())
        await asyncio.wait_for(ready.wait(), timeout=10)
        saving = asyncio.create_task(save())
        await asyncio.sleep(0.05)
        assert not saving.done(), "The writer must wait for the short current-read lock"
        continue_read.set()
        page = await asyncio.wait_for(reading, timeout=10)
        result = await asyncio.wait_for(saving, timeout=10)
        assert page["content_version"] == 2
        assert page["blocks"]["blocks"][0]["content"][0]["text"] == "Original"
        assert result["content_version"] == 3

    client.portal.call(run_race)
