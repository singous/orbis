"""Readonly content version helpers never select a new storage authority."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.application.legacy_block_pages import legacy_source
from orbis_user_api.domain.legacy_note_blocks import editable_note_blocks
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.note_block import NoteBlockSnapshot
from orbis_user_api.services.exceptions import NoteNotFound, NoteVersionConflict


async def current_content_version(note: Note, session: AsyncSession) -> int:
    header = await BlockContentStore(session, note).header()
    if header is not None:
        return header.content_version
    version = await session.scalar(
        select(NoteContent.content_version).where(NoteContent.note_id == note.id)
    )
    if version is None:
        raise NoteNotFound
    return version


async def native_snapshot_exists(
    note_id: UUID, version: int, session: AsyncSession
) -> bool:
    return (
        await session.scalar(
            select(NoteBlockSnapshot.id).where(
                NoteBlockSnapshot.note_id == note_id,
                NoteBlockSnapshot.content_version == version,
            )
        )
        is not None
    )


async def readonly_content(
    note: Note, version: int, session: AsyncSession
) -> NoteContent:
    if await native_snapshot_exists(note.id, version, session):
        return await BlockContentStore(session, note).full(version)
    table, selected, created, updated, _schema = await legacy_source(
        note, session, version
    )
    blocks = await session.scalar(
        select(table.blocks).where(
            table.note_id == note.id, table.content_version == selected
        )
    )
    if not isinstance(blocks, dict) or blocks.get("schema_version") not in {1, 2}:
        raise NoteVersionConflict
    return NoteContent(
        note_id=note.id,
        content_version=selected,
        blocks=blocks,
        plain_text="",
        created_at_ms=created,
        updated_at_ms=updated,
    )


def projected_records(note_id: UUID, content: dict) -> list[dict[str, Any]]:
    result = []

    def visit(items, parent):
        for position, block in enumerate(items):
            result.append(
                {
                    "id": block["id"],
                    "parent_id": parent,
                    "position": position,
                    "block": {
                        key: value for key, value in block.items() if key != "children"
                    },
                }
            )
            visit(block.get("children", []), block["id"])

    visit(editable_note_blocks(note_id, content)["blocks"], None)
    return result


async def legacy_outline(note, version, cursor, limit, session):
    content = await readonly_content(note, version, session)
    records = [
        record
        for record in projected_records(note.id, content.blocks)
        if record["block"]["type"] == "heading"
    ]
    selected = records[cursor : cursor + limit]
    return {
        "note_id": note.id,
        "content_version": version,
        "items": [
            {
                "id": record["id"],
                "parent_id": record["parent_id"],
                "level": record["block"].get("props", {}).get("level", 1),
                "text": derive_plain_text(
                    {
                        "schema_version": 2,
                        "blocks": [{**record["block"], "children": []}],
                    }
                )[:256],
                "block_revision": version,
            }
            for record in selected
        ],
        "next_cursor": cursor + limit if len(records) > cursor + limit else None,
        "has_more": len(records) > cursor + limit,
    }


async def legacy_changes(note, since, target, cursor, limit, session):
    # Legacy history contains complete snapshots; explicit history comparison
    # reads these snapshots without mutating headers or minting block versions.
    before = {
        row["id"]: row
        for row in projected_records(
            note.id, (await readonly_content(note, since, session)).blocks
        )
    }
    after = {
        row["id"]: row
        for row in projected_records(
            note.id, (await readonly_content(note, target, session)).blocks
        )
    }
    changed = sorted(
        identifier
        for identifier in before.keys() | after.keys()
        if before.get(identifier) != after.get(identifier)
    )
    selected = changed[cursor : cursor + limit]
    return {
        "note_id": note.id,
        "since_version": since,
        "content_version": target,
        "items": [
            {
                "id": identifier,
                "change": "upsert" if identifier in after else "deleted",
                "block_revision": target if identifier in after else None,
            }
            for identifier in selected
        ],
        "next_cursor": cursor + limit if len(changed) > cursor + limit else None,
        "has_more": len(changed) > cursor + limit,
        "storage_format": "legacy",
    }
