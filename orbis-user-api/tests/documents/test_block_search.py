from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects import sqlite

from orbis_user_api.application.block_search import ContentText
from orbis_user_api.models.note import Note, NoteContent

from .test_bounded_blocks import paragraph
from .test_content_pages import seed


def test_recursive_search_uses_parent_index_and_preserves_full_cross_block_text(client):
    roots = [paragraph("first", "alpha"), paragraph("second", "beta")]
    roots.append(
        {
            **paragraph("parent", "container"),
            "children": [
                paragraph(f"child-{index}", f"child {index}") for index in range(1000)
            ],
        }
    )
    note_id, headers, _ = seed(client, roots)

    async def query_plan():
        statement = (
            select(ContentText(Note.id, NoteContent.plain_text))
            .join(NoteContent, NoteContent.note_id == Note.id)
            .where(Note.id == UUID(note_id))
        )
        sql = str(
            statement.compile(
                dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True}
            )
        )
        async with client.app.state.session_factory() as session:
            return (await session.execute(text("EXPLAIN QUERY PLAN " + sql))).all()

    steps = [row[3] for row in client.portal.call(query_plan)]
    recursive_step = steps.index("RECURSIVE STEP")
    assert steps[recursive_step + 1] == "SCAN w"
    assert "note_id=? AND parent_id=?" in steps[recursive_step + 2]
    items = client.get("/notes", headers=headers).json()["data"]["items"]
    assert items[0]["plain_text"] == "\n".join(
        ["alpha", "beta", "container", *(f"child {index}" for index in range(1000))]
    )
    response = client.get("/notes", headers=headers, params={"q": "alpha\nbeta"})
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["data"]["items"]] == [note_id]
