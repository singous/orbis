from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import Integer, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.application.notes import get_note
from orbis_user_api.db.types import GUID
from orbis_user_api.domain.block_records import flatten_blocks
from orbis_user_api.domain.legacy_note_blocks import editable_note_blocks
from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    derive_plain_text,
    normalize_note_blocks,
)
from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import NoteContent
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    NoteContentPageOut,
    NoteContentPrefixOut,
    NoteContentPrefixRequest,
)
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
)

# Project only the requested JSON fragment into the application process.
SQLITE_PAGE = """
SELECT content_version, created_at_ms, updated_at_ms,
 json_extract(blocks, '$.schema_version') AS schema_version,
 json_array_length(blocks, '$.blocks') AS total_blocks,
 (SELECT json_group_array(json(value)) FROM
   (SELECT value FROM json_each(c.blocks, '$.blocks')
    WHERE CAST(key AS INTEGER) >= :offset AND CAST(key AS INTEGER) < :end ORDER BY CAST(key AS INTEGER))) AS items
FROM note_contents c WHERE note_id = :note_id
AND (:version IS NULL OR content_version = :version)
"""
POSTGRES_PAGE = """
SELECT content_version, created_at_ms, updated_at_ms,
 (blocks->>'schema_version')::integer AS schema_version,
 jsonb_array_length(blocks->'blocks') AS total_blocks,
 coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM
   jsonb_array_elements(c.blocks->'blocks') WITH ORDINALITY AS item(value, ordinal)
   WHERE ordinal > :offset AND ordinal <= :end), '[]'::jsonb) AS items
FROM note_contents c WHERE note_id = :note_id
AND (CAST(:version AS integer) IS NULL OR content_version = CAST(:version AS integer))
"""


async def get_note_content_page(
    note_id: UUID,
    user: User,
    session: AsyncSession,
    *,
    offset: int,
    limit: int,
    version: int | None,
) -> NoteContentPageOut:
    note = await get_note(note_id, user, session)
    store = BlockContentStore(session, note)
    if await store.header() is not None:
        return NoteContentPageOut(**await store.page(offset, limit, version))
    sql = (
        POSTGRES_PAGE
        if session.get_bind().dialect.name == "postgresql"
        else SQLITE_PAGE
    )
    query = text(sql).bindparams(
        bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
    )
    row = (
        (
            await session.execute(
                query,
                {
                    "note_id": note_id,
                    "offset": offset,
                    "end": offset + limit,
                    "version": version,
                },
            )
        )
        .mappings()
        .one_or_none()
    )
    source_table = NoteContent
    if row is None and version is not None:
        # Subsequent pages keep the first read's immutable snapshot while the
        # local editor saves its loaded prefix. History remains access checked.
        revision_sql = sql.replace("note_contents c", "note_revisions c").replace(
            "created_at_ms, updated_at_ms",
            "created_at_ms, created_at_ms AS updated_at_ms",
        )
        revision_sql += " AND workspace_id = :workspace_id"
        revision_query = text(revision_sql).bindparams(
            bindparam("note_id", type_=GUID()),
            bindparam("workspace_id", type_=GUID()),
            bindparam("version", type_=Integer()),
        )
        row = (
            (
                await session.execute(
                    revision_query,
                    {
                        "note_id": note_id,
                        "workspace_id": note.workspace_id,
                        "offset": offset,
                        "end": offset + limit,
                        "version": version,
                    },
                )
            )
            .mappings()
            .one_or_none()
        )
        source_table = NoteRevision
    if row is None:
        if version is not None:
            raise NoteVersionConflict
        raise NoteNotFound
    if row["schema_version"] == 2:
        items = (
            json.loads(row["items"]) if isinstance(row["items"], str) else row["items"]
        )
        total = row["total_blocks"]
    else:
        # Legacy documents are projected without changing their stored format.
        source = await session.scalar(
            select(source_table.blocks).where(
                source_table.note_id == note_id,
                source_table.content_version == row["content_version"],
            )
        )
        if source is None:
            raise NoteVersionConflict
        try:
            roots = editable_note_blocks(note_id, source)["blocks"]
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        items, total = roots[offset : offset + limit], len(roots)
    end = offset + len(items)
    return NoteContentPageOut(
        note_id=note_id,
        blocks={"schema_version": 2, "editor": "blocknote", "blocks": items},
        content_version=row["content_version"],
        created_at_ms=row["created_at_ms"],
        updated_at_ms=row["updated_at_ms"],
        offset=offset,
        next_offset=end,
        total_blocks=total,
        has_more=end < total,
    )


async def save_note_content_prefix(
    note_id: UUID, payload: NoteContentPrefixRequest, user: User, session: AsyncSession
) -> NoteContentPrefixOut:
    note = await get_note(note_id, user, session)
    store = BlockContentStore(session, note)
    header = await store.activate()
    if header.content_version != payload.expected_version:
        raise NoteVersionConflict
    page = await store.page(0, len(payload.loaded_block_ids), header.content_version)
    original = page["blocks"]
    if [block["id"] for block in original["blocks"]] != payload.loaded_block_ids:
        raise NoteVersionConflict
    try:
        if payload.blocks.get("schema_version") != 2:
            raise InvalidNoteContent
        current = normalize_note_blocks(payload.blocks)
        before = flatten_blocks(original)
        after = flatten_blocks(current)
    except InvalidNoteContent:
        raise NoteContentInvalid from None
    manifest = await store._manifest([row["block_id"] for row in after])
    old_ids, new_ids = (
        {row["block_id"] for row in before},
        {row["block_id"] for row in after},
    )
    if new_ids.intersection(set(manifest) - old_ids):
        raise NoteContentInvalid
    anchors = {}
    moves = []
    for row in after:
        parent = row["parent_id"]
        moves.append(
            {
                "id": row["block_id"],
                "parent_id": parent,
                "after_id": anchors.get(parent),
            }
        )
        anchors[parent] = row["block_id"]
    result = await store.changes(
        payload.expected_version,
        [row["payload"] for row in after],
        moves,
        list(old_ids - new_ids),
        user,
    )
    return NoteContentPrefixOut(
        **result, loaded_block_ids=[block["id"] for block in current["blocks"]]
    )


async def get_note_content_outline(
    note_id: UUID, user: User, session: AsyncSession, version: int
) -> dict:
    note = await get_note(note_id, user, session)
    store = BlockContentStore(session, note)
    if await store.header() is not None:
        return await store.outline(version)
    current = await session.scalar(
        select(NoteContent.content_version).where(NoteContent.note_id == note_id)
    )
    source = NoteContent if current == version else NoteRevision
    snapshot_filter = [source.note_id == note_id, source.content_version == version]
    if source is NoteRevision:
        snapshot_filter.append(source.workspace_id == note.workspace_id)
    schema_version = await session.scalar(
        select(source.blocks["schema_version"].as_integer()).where(*snapshot_filter)
    )
    if schema_version is None:
        raise NoteVersionConflict
    if schema_version != 2:
        stored = await session.scalar(select(source.blocks).where(*snapshot_filter))
        try:
            roots = editable_note_blocks(note_id, stored)["blocks"]
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        return {
            "content_version": version,
            "items": [
                {
                    "id": block["id"],
                    "level": block.get("props", {}).get("level", 1),
                    "text": derive_plain_text({"schema_version": 2, "blocks": [block]})[
                        :256
                    ]
                    or "未命名标题",
                    "root_index": index,
                }
                for index, block in enumerate(roots)
                if block["type"] == "heading"
            ],
        }
    table = source.__tablename__
    if session.get_bind().dialect.name == "postgresql":
        sql = f"SELECT value->>'id' AS id, value->'props'->>'level' AS level, value->'content' AS content, ordinal-1 AS root_index FROM {table} c, jsonb_array_elements(c.blocks->'blocks') WITH ORDINALITY AS item(value,ordinal) WHERE c.note_id=:note_id AND c.content_version=:version AND value->>'type'='heading' ORDER BY ordinal"
    else:
        sql = f"SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.props.level') AS level,json_extract(value,'$.content') AS content,CAST(key AS INTEGER) AS root_index FROM {table} c,json_each(c.blocks,'$.blocks') WHERE c.note_id=:note_id AND c.content_version=:version AND json_extract(value,'$.type')='heading' ORDER BY CAST(key AS INTEGER)"
    query = text(sql).bindparams(
        bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
    )
    rows = (
        (await session.execute(query, {"note_id": note_id, "version": version}))
        .mappings()
        .all()
    )
    result = []
    for row in rows:
        inline = (
            json.loads(row["content"])
            if isinstance(row["content"], str)
            else row["content"]
        )
        label = derive_plain_text(
            {
                "schema_version": 2,
                "blocks": [{"type": "heading", "content": inline, "children": []}],
            }
        )
        result.append(
            {
                "id": row["id"],
                "level": int(row["level"] or 1),
                "text": label[:256] or "未命名标题",
                "root_index": row["root_index"],
            }
        )
    return {"content_version": version, "items": result}
