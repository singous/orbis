"""Bounded body anchors keep agents from scanning whole matching documents."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.note_block import NoteBlockDocument
from orbis_user_api.models.note_block import NoteBlockVersion as Block

SEARCH_SNIPPET_CHARACTERS = 160
SEARCH_CONTEXT_CHARACTERS = 60


async def body_anchors(
    note_ids: list[UUID], query: str, session: AsyncSession
) -> dict[UUID, dict]:
    if not note_ids:
        return {}
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    is_postgres = session.get_bind().dialect.name == "postgresql"
    location = (func.strpos if is_postgres else func.instr)(
        func.lower(Block.plain_text), query.lower()
    )
    start = (func.greatest if is_postgres else func.max)(
        1, location - SEARCH_CONTEXT_CHARACTERS
    )
    hits = (
        select(
            Block.note_id,
            Block.block_id,
            Block.parent_id,
            Block.valid_from,
            func.substr(Block.plain_text, start, SEARCH_SNIPPET_CHARACTERS).label(
                "snippet"
            ),
            func.row_number()
            .over(partition_by=Block.note_id, order_by=(Block.position, Block.block_id))
            .label("rank"),
        )
        .where(
            Block.note_id.in_(note_ids),
            Block.valid_to.is_(None),
            func.lower(Block.plain_text).like(f"%{escaped.lower()}%", escape="\\"),
        )
        .subquery()
    )
    rows = (
        await session.execute(
            select(hits, NoteBlockDocument.content_version)
            .join(NoteBlockDocument, NoteBlockDocument.note_id == hits.c.note_id)
            .where(hits.c.rank == 1)
        )
    ).all()
    return {
        row.note_id: {
            "content_version": row.content_version,
            "matches": [
                {
                    "block_id": row.block_id,
                    "parent_id": row.parent_id,
                    "block_revision": row.valid_from,
                    "snippet": row.snippet,
                }
            ],
        }
        for row in rows
    }
