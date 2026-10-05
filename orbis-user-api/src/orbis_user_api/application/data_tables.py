"""Atomic table commands coordinated with the owning document's version."""

from copy import deepcopy
import hashlib
import json
import logging

from sqlalchemy import String, cast, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.application.collaboration import _authorize_note
from orbis_user_api.application.data_table_query import (
    at_revision,
    record_page,
    scalar_value,
)
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.domain.data_tables import (
    InvalidTable,
    default_definition,
    validate_definition,
    validate_value,
)
from orbis_user_api.domain.data_table_copy import copy_definition
from orbis_user_api.models.data_table import (
    DataTable,
    DataTableReceipt,
    DataTableRecord,
    DataTableRevision,
)
from orbis_user_api.schemas.data_table import (
    TableCreate,
    TableDefinition,
    TableMutation,
)
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import NoteNotFound, NoteVersionConflict

logger = logging.getLogger(__name__)
MAX_COPY_RECORDS = 50000
MAX_RECORD_BYTES = 64 * 1024


async def authorize_table(
    note_id, table_id, user, session: AsyncSession, *, write=False
):
    note, membership = await _authorize_note(note_id, user, session)
    if write:
        AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    table = await session.get(DataTable, table_id)
    if (
        table is None
        or table.note_id != note.id
        or table.workspace_id != note.workspace_id
    ):
        raise NoteNotFound
    return note, table


async def referenced_table(note, table, session, *, document_version=None):
    store = BlockContentStore(session, note)
    version = document_version or await store.current_version()
    result = await store.block(table.block_id, version)
    block = result["block"]
    if block["type"] != "dataTable" or block.get("props", {}).get("table_id") != str(
        table.id
    ):
        raise NoteNotFound
    revision = block["props"].get("table_revision", 0)
    return block, version, await definition_at(session, table.id, revision)


async def definition_at(session, table_id, revision):
    row = await session.scalar(
        select(DataTableRevision).where(
            DataTableRevision.table_id == table_id,
            DataTableRevision.revision == revision,
        )
    )
    if row is None:
        raise NoteNotFound
    return TableDefinition.model_validate(row.definition)


def table_block(block, table_id, revision, definition):
    return {
        **block,
        "props": {
            "title": definition.title,
            "table_id": str(table_id),
            "table_revision": revision,
            "default_view_id": str(definition.views[0].id),
            "field_names": " ".join(field.name for field in definition.fields),
        },
        "children": [],
    }


def fingerprint(payload, table_id):
    value = {
        "table_id": str(table_id),
        "payload": payload.model_dump(mode="json", exclude_unset=True),
    }
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


async def replay(session, note_id, payload, table_id):
    row = await session.scalar(
        select(DataTableReceipt).where(
            DataTableReceipt.note_id == note_id,
            DataTableReceipt.operation_id == payload.operation_id,
        )
    )
    if row:
        if row.fingerprint != fingerprint(payload, table_id):
            raise InvalidTable("操作标识已用于不同内容，请重新提交")
        return row.result
    return None


async def commit_change(
    session,
    note,
    block,
    definition,
    table,
    revision,
    payload,
    user,
    inverse,
    *,
    identity,
):
    updated = table_block(block, table.id, revision, definition)
    shallow = {key: value for key, value in updated.items() if key != "children"}
    result = await BlockContentStore(session, note).changes(
        payload.expected_document_version, [shallow], [], [], user, commit=False
    )
    response = {
        "content_version": result["content_version"],
        "table_revision": revision,
        "table_id": str(table.id),
        "block": updated,
        "inverse": inverse,
    }
    session.add(
        DataTableReceipt(
            note_id=note.id,
            operation_id=payload.operation_id,
            fingerprint=fingerprint(payload, identity),
            result=response,
        )
    )
    await session.commit()
    logger.info(
        "Document table saved: note_id=%s table_id=%s revision=%s",
        note.id,
        table.id,
        revision,
    )
    return response


async def create_table(note_id, payload: TableCreate, user, session):
    note, membership = await _authorize_note(note_id, user, session)
    AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    if result := await replay(session, note.id, payload, None):
        return result
    store = BlockContentStore(session, note)
    if await store.current_version() != payload.expected_document_version:
        raise NoteVersionConflict
    block = (await store.block(payload.block_id, payload.expected_document_version))[
        "block"
    ]
    if block["type"] != "dataTable":
        raise InvalidTable("目标不是多维表格块")
    if block.get("props", {}).get("table_id") and payload.source_table_id is None:
        raise InvalidTable("表格已经初始化")
    definition = default_definition()
    source_records = []
    if payload.source_table_id:
        source = await session.get(DataTable, payload.source_table_id)
        if not source:
            raise NoteNotFound
        source_note, _ = await authorize_table(source.note_id, source.id, user, session)
        _, _, _ = await referenced_table(source_note, source, session)
        revision = payload.source_revision or source.head_revision
        definition = await definition_at(session, source.id, revision)
        source_records = list(
            await session.scalars(
                select(DataTableRecord)
                .where(at_revision(source.id, revision))
                .limit(MAX_COPY_RECORDS + 1)
            )
        )
        if len(source_records) > MAX_COPY_RECORDS:
            raise InvalidTable("表格超过本次复制预算，请分批处理")
    definition, copy_values = copy_definition(definition)
    table = DataTable(
        id=new_uuidv7(),
        note_id=note.id,
        workspace_id=note.workspace_id,
        block_id=payload.block_id,
        head_revision=1,
    )
    session.add(table)
    session.add(
        DataTableRevision(
            table_id=table.id, revision=1, definition=definition.model_dump(mode="json")
        )
    )
    session.add_all(
        DataTableRecord(
            table_id=table.id,
            record_id=new_uuidv7(),
            valid_from=1,
            values=copy_values(row.values),
        )
        for row in source_records
    )
    return await commit_change(
        session, note, block, definition, table, 1, payload, user, {}, identity=None
    )


async def mutate_table(note_id, table_id, payload: TableMutation, user, session):
    note, table = await authorize_table(note_id, table_id, user, session, write=True)
    if result := await replay(session, note.id, payload, table.id):
        return result
    block, version, previous = await referenced_table(note, table, session)
    base = block["props"]["table_revision"]
    if (
        version != payload.expected_document_version
        or base != payload.expected_table_revision
    ):
        raise NoteVersionConflict
    definition = payload.definition or previous
    validate_definition(definition, previous)
    fields = {str(field.id): field for field in definition.fields}
    ids = [item.id for item in payload.upserts] + payload.deletes
    if len(ids) != len(set(ids)):
        raise InvalidTable("同一操作不能重复修改或删除记录")
    if not ids and payload.definition is None:
        raise InvalidTable("没有需要保存的变更")
    rows = (
        list(
            await session.scalars(
                select(DataTableRecord).where(
                    at_revision(table.id, base), DataTableRecord.record_id.in_(ids)
                )
            )
        )
        if ids
        else []
    )
    old = {row.record_id: row for row in rows}
    inverse_fields = {str(field.id) for field in previous.fields}
    inverse = {
        "upserts": [
            {
                "id": str(row.record_id),
                "values": {
                    key: deepcopy(value)
                    for key, value in row.values.items()
                    if key in inverse_fields
                },
            }
            for row in rows
        ],
        "deletes": [str(item.id) for item in payload.upserts if item.id not in old],
    }
    if payload.definition:
        inverse["definition"] = previous.model_dump(mode="json")
    replacements = []
    for item in payload.upserts:
        if not set(item.values) <= fields.keys():
            raise InvalidTable("记录包含不存在的字段")
        values = deepcopy(old[item.id].values) if item.id in old else {}
        for key, value in item.values.items():
            values[key] = validate_value(fields[key], value)
        for key, field in fields.items():
            if key in values:
                validate_value(field, values[key])
        if len(json.dumps(values, ensure_ascii=False).encode()) > MAX_RECORD_BYTES:
            raise InvalidTable("单条记录超过 64 KiB，请缩短字段内容")
        replacements.append((item.id, values))
        if item.id in old:
            before = next(
                row for row in inverse["upserts"] if row["id"] == str(item.id)
            )
            before["values"].update(
                {key: None for key in item.values if key not in before["values"]}
            )
    if payload.definition:
        for old_field in previous.fields:
            field = fields.get(str(old_field.id))
            if field is None or field.kind not in {"select", "multi_select"}:
                continue
            removed = {str(option.id) for option in old_field.options} - {
                str(option.id) for option in field.options
            }
            if not removed:
                continue
            value = scalar_value(field)
            matches = (
                value.in_(removed)
                if field.kind == "select"
                else or_(
                    *(
                        cast(value, String).contains(f'"{option}"', autoescape=True)
                        for option in removed
                    )
                )
            )
            used = await session.scalar(
                select(DataTableRecord.id)
                .where(
                    at_revision(table.id, base),
                    DataTableRecord.record_id.not_in(ids),
                    matches,
                )
                .limit(1)
            )
            if used:
                raise InvalidTable(f"字段“{field.name}”仍有记录使用被移除的选项")
    revision = table.head_revision + 1
    claimed = await session.execute(
        update(DataTable)
        .where(DataTable.id == table.id, DataTable.head_revision == table.head_revision)
        .values(head_revision=revision)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        raise NoteVersionConflict
    # A historical reference starts a new branch by reusing its values at a new
    # monotonic revision. Ordinary edits only touch their target record IDs.
    if base != table.head_revision:
        baseline = list(
            await session.scalars(
                select(DataTableRecord).where(at_revision(table.id, base))
            )
        )
        await session.execute(
            update(DataTableRecord)
            .where(
                DataTableRecord.table_id == table.id, DataTableRecord.valid_to.is_(None)
            )
            .values(valid_to=revision)
        )
        session.add_all(
            DataTableRecord(
                table_id=table.id,
                record_id=row.record_id,
                valid_from=revision,
                values=deepcopy(row.values),
            )
            for row in baseline
            if row.record_id not in ids
        )
    elif ids:
        await session.execute(
            update(DataTableRecord)
            .where(
                DataTableRecord.table_id == table.id,
                DataTableRecord.record_id.in_(ids),
                DataTableRecord.valid_to.is_(None),
            )
            .values(valid_to=revision)
        )
    session.add_all(
        DataTableRecord(
            table_id=table.id, record_id=record_id, valid_from=revision, values=values
        )
        for record_id, values in replacements
    )
    session.add(
        DataTableRevision(
            table_id=table.id,
            revision=revision,
            definition=definition.model_dump(mode="json"),
        )
    )
    return await commit_change(
        session,
        note,
        block,
        definition,
        table,
        revision,
        payload,
        user,
        inverse,
        identity=table.id,
    )


async def read_table(
    note,
    table,
    session,
    *,
    view_id=None,
    offset=0,
    limit=50,
    expected_revision=None,
    group=None,
    public=False,
):
    block, version, definition = await referenced_table(note, table, session)
    revision = block["props"]["table_revision"]
    if expected_revision is not None and revision != expected_revision:
        raise NoteVersionConflict
    selected = (
        definition.public_view_id if public else view_id or definition.views[0].id
    )
    view = next((view for view in definition.views if view.id == selected), None)
    if view is None:
        raise InvalidTable("视图不存在")
    page = await record_page(
        session, table.id, revision, definition, view, offset, limit, group=group
    )
    if public:
        allowed = {str(field) for field in definition.public_field_ids}
        # Query predicates may use private fields, but no private schema, option,
        # filter value, group count or record value leaves the projection.
        safe_view = view.model_copy(
            update={
                "field_ids": [
                    field for field in view.field_ids if str(field) in allowed
                ],
                "filters": [],
                "sorts": [],
                "group_field_id": view.group_field_id
                if str(view.group_field_id) in allowed
                else None,
                "widths": {k: v for k, v in view.widths.items() if k in allowed},
            }
        )
        definition = definition.model_copy(
            update={
                "fields": [
                    field for field in definition.fields if str(field.id) in allowed
                ],
                "views": [safe_view],
            }
        )
        page["records"] = [
            {
                **row,
                "values": {
                    key: value for key, value in row["values"].items() if key in allowed
                },
            }
            for row in page["records"]
        ]
        if safe_view.group_field_id is None:
            page["groups"] = []
    return {
        "table_id": str(table.id),
        "revision": revision,
        "content_version": version,
        "definition": definition.model_dump(mode="json"),
        "view_id": str(selected),
        **page,
    }
