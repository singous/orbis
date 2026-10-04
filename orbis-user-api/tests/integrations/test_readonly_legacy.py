from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, event, select

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.models.note import NoteContent
from orbis_user_api.models.note_block import (
    NoteBlockDocument,
    NoteBlockSnapshot,
    NoteBlockVersion,
)


@pytest.fixture()
def legacy(client, library):
    note_id = UUID(library["note"]["id"])
    source = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "legacy-heading",
                "type": "heading",
                "props": {"level": 2},
                "content": [{"type": "text", "text": "Legacy heading"}],
                "children": [],
            },
            *library["blocks"],
        ],
    }

    async def reset_authority():
        async with client.app.state.session_factory() as session:
            for model in (NoteBlockVersion, NoteBlockSnapshot, NoteBlockDocument):
                await session.execute(delete(model).where(model.note_id == note_id))
            content = await session.scalar(
                select(NoteContent).where(NoteContent.note_id == note_id)
            )
            content.blocks, content.content_version = source, 2
            await session.commit()

    client.portal.call(reset_authority)
    return library


def test_agent_get_paths_cannot_activate_legacy_documents(client, legacy, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("A readonly Agent request attempted activation")

    monkeypatch.setattr(BlockContentStore, "activate", forbidden)
    path = f"/open/v1/notes/{legacy['note']['id']}"
    for suffix, query in [
        ("", {}),
        ("/outline", {}),
        ("/blocks", {}),
        ("/blocks/p1", {}),
        ("/changes", {"since_version": 2}),
        ("/export", {"version": 2, "format": "json"}),
    ]:
        response = client.get(path + suffix, headers=legacy["headers"], params=query)
        assert response.status_code == 200, response.text

    async def headers():
        async with client.app.state.session_factory() as session:
            return await session.scalar(
                select(NoteBlockDocument.id).where(
                    NoteBlockDocument.note_id == UUID(legacy["note"]["id"])
                )
            )

    assert client.portal.call(headers) is None


def test_legacy_preview_uses_readonly_validation_and_mints_no_storage_rows(
    client, legacy, monkeypatch
):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Preview attempted activation")

    monkeypatch.setattr(BlockContentStore, "activate", forbidden)
    statements = []
    engine = client.app.state.engine.sync_engine

    def capture(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        path = f"/open/v1/notes/{legacy['note']['id']}"
        request = {
            "operation_id": str(uuid4()),
            "expected_version": 2,
            "operations": [
                {
                    "type": "replace_text",
                    "block_id": "p1",
                    "match": "Draft",
                    "replacement": "Preview only",
                }
            ],
        }
        response = client.post(
            path + "/operations/preview", headers=legacy["headers"], json=request
        )
        assert response.status_code == 200, response.text
        assert response.json()["data"]["durability"] == "preview"
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert not any(
        "INSERT INTO note_block" in statement
        or "UPDATE note_contents" in statement
        or "UPDATE notes SET" in statement
        for statement in statements
    )
    original = client.get(path + "/blocks/p1", headers=legacy["headers"]).json()["data"]
    assert original["block"]["content"][0]["text"] == "Draft"
