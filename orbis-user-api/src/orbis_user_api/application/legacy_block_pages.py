"""Read old JSON documents without activating storage in a GET request."""

from __future__ import annotations

import json

from sqlalchemy import Integer, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_pages import bounded_page, json_bytes
from orbis_user_api.db.types import GUID
from orbis_user_api.domain.legacy_note_blocks import editable_note_blocks
from orbis_user_api.domain.note_content import InvalidNoteContent
from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
)


async def legacy_source(note: Note, session: AsyncSession, version: int | None):
    current = (
        await session.execute(
            select(
                NoteContent.content_version,
                NoteContent.created_at_ms,
                NoteContent.updated_at_ms,
                NoteContent.blocks["schema_version"].as_integer(),
            ).where(NoteContent.note_id == note.id)
        )
    ).first()
    if current is None:
        raise NoteNotFound
    if version is None or version == current[0]:
        return NoteContent, current[0], current[1], current[2], current[3]
    past = (
        await session.execute(
            select(
                NoteRevision.created_at_ms,
                NoteRevision.blocks["schema_version"].as_integer(),
            ).where(
                NoteRevision.note_id == note.id,
                NoteRevision.workspace_id == note.workspace_id,
                NoteRevision.content_version == version,
            )
        )
    ).first()
    if past is None:
        raise NoteVersionConflict
    return NoteRevision, version, past[0], past[0], past[1]


def query_text(session, table, parent_id, *, exact=False):
    postgres = session.get_bind().dialect.name == "postgresql"
    table_name = table.__tablename__
    if postgres:
        target = (
            "c.blocks->'blocks'"
            if parent_id is None
            else "jsonb_path_query_first(c.blocks, 'strict $.blocks[*].** ? (@.id == $target)', jsonb_build_object('target', CAST(:parent_id AS text))) -> 'children'"
        )
        if exact:
            target = "jsonb_build_array(jsonb_path_query_first(c.blocks, 'strict $.blocks[*].** ? (@.id == $target)', jsonb_build_object('target', CAST(:parent_id AS text))))"
        root = f"WITH source AS (SELECT coalesce({target}, '[]'::jsonb) AS items FROM {table_name} c WHERE c.note_id=:note_id AND c.content_version=:version)"
        metadata = "SELECT value->>'id' AS id, value->>'type' AS block_type, jsonb_array_length(coalesce(value->'children','[]'::jsonb)) AS child_count, octet_length((value-'children')::text) AS payload_bytes, ordinal - 1 AS ordinal FROM source, jsonb_array_elements(items) WITH ORDINALITY e(value,ordinal) WHERE jsonb_typeof(value)='object' ORDER BY ordinal LIMIT :limit OFFSET :offset"
        payload = "SELECT value-'children' AS payload FROM source, jsonb_array_elements(items) WITH ORDINALITY e(value,ordinal) WHERE ordinal - 1=:ordinal"
        total = "SELECT jsonb_array_length(items) AS total FROM source"
    else:
        if parent_id is None:
            root = f"WITH source AS (SELECT json_extract(blocks,'$.blocks') AS items FROM {table_name} WHERE note_id=:note_id AND content_version=:version)"
        else:
            # Materialize the JSON traversal once. Correlated scalar lookups
            # inside json_tree otherwise repeat it for every visited JSON node.
            projected = (
                "json_array(json(value))"
                if exact
                else "coalesce(json_extract(value,'$.children'),'[]')"
            )
            root = f"""WITH doc AS (SELECT blocks FROM {table_name} WHERE note_id=:note_id AND content_version=:version),
                tree AS MATERIALIZED (SELECT jt.id,jt.parent,jt.key,jt.value,jt.atom FROM doc,json_tree(doc.blocks) jt),
                target AS (SELECT b.value FROM tree i JOIN tree b ON b.id=i.parent WHERE i.key='id' AND i.atom=:parent_id LIMIT 1),
                source AS (SELECT {projected} AS items FROM target)"""
        metadata = "SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.type') AS block_type,coalesce(json_array_length(value,'$.children'),0) AS child_count,length(CAST(json_remove(value,'$.children') AS BLOB)) AS payload_bytes,CAST(key AS INTEGER) AS ordinal FROM source,json_each(items) ORDER BY CAST(key AS INTEGER) LIMIT :limit OFFSET :offset"
        payload = "SELECT json_remove(value,'$.children') AS payload FROM source,json_each(items) WHERE CAST(key AS INTEGER)=:ordinal"
        total = "SELECT json_array_length(items) AS total FROM source"
    return root, metadata, payload, total


async def read_legacy_page(
    note: Note, session: AsyncSession, parent_id, offset, limit, version, max_bytes
):
    table, version, created, updated, schema = await legacy_source(
        note, session, version
    )
    base = {
        "note_id": note.id,
        "storage_format": "legacy",
        "parent_id": parent_id,
        "content_version": version,
        "created_at_ms": created,
        "updated_at_ms": updated,
        "offset": offset,
        "next_offset": offset,
    }
    if schema != 2:
        # Schema 1 has no block-addressable structure. Preserve its stable legacy
        # projection and read-only behavior; preflight backfill removes this
        # compatibility cost before enabling the new editor for existing data.
        stored = await session.scalar(
            select(table.blocks).where(
                table.note_id == note.id, table.content_version == version
            )
        )
        try:
            projected = editable_note_blocks(note.id, stored)["blocks"]
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        siblings = projected
        if parent_id is not None:
            stack = list(projected)
            found = None
            while stack:
                block = stack.pop()
                if block["id"] == parent_id:
                    found = block
                    break
                stack.extend(block.get("children", []))
            if found is None:
                raise NoteContentInvalid
            siblings = found.get("children", [])
        base.update(total_blocks=len(siblings), has_more=offset < len(siblings))
        rows = [
            {
                "id": block["id"],
                "block_type": block["type"],
                "child_count": len(block.get("children", [])),
                "payload_bytes": json_bytes(
                    {key: value for key, value in block.items() if key != "children"}
                ),
                "payload": {
                    key: value for key, value in block.items() if key != "children"
                },
            }
            for block in siblings[offset : offset + limit]
        ]

        async def load(row):
            return row["payload"]

        return await bounded_page(base, rows, load, max_bytes)
    if parent_id is not None:
        parent_root, parent_metadata, _payload, _total = query_text(
            session, table, parent_id, exact=True
        )
        parent_query = text(parent_root + " " + parent_metadata).bindparams(
            bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
        )
        parent = (
            (
                await session.execute(
                    parent_query,
                    {
                        "note_id": note.id,
                        "version": version,
                        "parent_id": parent_id,
                        "limit": 1,
                        "offset": 0,
                    },
                )
            )
            .mappings()
            .first()
        )
        if parent is None or parent["id"] is None:
            raise NoteContentInvalid
    root, metadata_sql, payload_sql, total_sql = query_text(session, table, parent_id)
    params = {
        "note_id": note.id,
        "version": version,
        "parent_id": parent_id,
        "limit": limit,
        "offset": offset,
    }

    def query(sql):
        return text(root + " " + sql).bindparams(
            bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
        )

    total = await session.scalar(query(total_sql), params)
    if total is None:
        if parent_id is not None:
            raise NoteContentInvalid
        raise NoteVersionConflict
    base.update(total_blocks=total, has_more=offset < total)
    rows = list((await session.execute(query(metadata_sql), params)).mappings())

    async def load(row):
        value = await session.scalar(
            query(payload_sql), {**params, "ordinal": row["ordinal"]}
        )
        return json.loads(value) if isinstance(value, str) else value

    return await bounded_page(base, rows, load, max_bytes)


async def read_legacy_block(
    note: Note, session: AsyncSession, identifier: str, version: int | None
):
    table, version, _created, _updated, schema = await legacy_source(
        note, session, version
    )
    if schema != 2:
        stored = await session.scalar(
            select(table.blocks).where(
                table.note_id == note.id, table.content_version == version
            )
        )
        stack = editable_note_blocks(note.id, stored)["blocks"][:]
        parents = {block["id"]: None for block in stack}
        while stack:
            block = stack.pop()
            if block["id"] == identifier:
                payload = {
                    key: value for key, value in block.items() if key != "children"
                }
                count = len(block.get("children", []))
                return {
                    "note_id": note.id,
                    "content_version": version,
                    "block_revision": version,
                    "block": {**payload, "children": []},
                    "descriptor": {
                        "id": identifier,
                        "parent_id": parents[identifier],
                        "child_count": count,
                        "has_children": count > 0,
                        "children_loaded": count == 0,
                        "payload_loaded": True,
                        "payload_bytes": json_bytes(payload),
                    },
                }
            for child in block.get("children", []):
                parents[child["id"]] = block["id"]
                stack.append(child)
        raise NoteNotFound
    root, metadata_sql, payload_sql, _total_sql = query_text(
        session, table, identifier, exact=True
    )
    params = {
        "note_id": note.id,
        "version": version,
        "parent_id": identifier,
        "limit": 1,
        "offset": 0,
        "ordinal": 0,
    }

    def query(sql):
        return text(root + " " + sql).bindparams(
            bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
        )

    row = (await session.execute(query(metadata_sql), params)).mappings().first()
    if row is None or row["id"] is None:
        raise NoteNotFound
    value = await session.scalar(query(payload_sql), params)
    payload = json.loads(value) if isinstance(value, str) else value
    count = row["child_count"]
    if session.get_bind().dialect.name == "postgresql":
        parent_sql = f"""WITH RECURSIVE tree(block,parent_id) AS (
            SELECT value,NULL::text FROM {table.__tablename__} c,
            jsonb_array_elements(c.blocks->'blocks') e(value)
            WHERE c.note_id=:note_id AND c.content_version=:version
            UNION ALL SELECT value,t.block->>'id' FROM tree t,
            jsonb_array_elements(coalesce(t.block->'children','[]'::jsonb)) e(value))
            SELECT parent_id FROM tree WHERE block->>'id'=:parent_id LIMIT 1"""
    else:
        parent_sql = f"""WITH doc AS (SELECT blocks FROM {table.__tablename__}
            WHERE note_id=:note_id AND content_version=:version),
            tree AS MATERIALIZED (SELECT jt.id,jt.parent,jt.key,jt.value,jt.atom FROM doc,json_tree(doc.blocks) jt)
            SELECT json_extract(p.value,'$.id') FROM tree i
            JOIN tree b ON b.id=i.parent JOIN tree a ON a.id=b.parent JOIN tree p ON p.id=a.parent
            WHERE i.key='id' AND i.atom=:parent_id LIMIT 1"""
    parent_query = text(parent_sql).bindparams(
        bindparam("note_id", type_=GUID()), bindparam("version", type_=Integer())
    )
    parent_id = await session.scalar(parent_query, params)
    return {
        "note_id": note.id,
        "content_version": version,
        "block_revision": version,
        "block": {**payload, "children": []},
        "descriptor": {
            "id": identifier,
            "parent_id": parent_id,
            "child_count": count,
            "has_children": count > 0,
            "children_loaded": count == 0,
            "payload_loaded": True,
            "payload_bytes": row["payload_bytes"],
        },
    }
