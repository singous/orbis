"""Stage complete independent copies without committing the caller's transaction."""

import json
from sqlalchemy import select

from orbis_user_api.application.data_table_query import at_revision
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.domain.data_table_copy import copy_definition
from orbis_user_api.domain.data_tables import InvalidTable
from orbis_user_api.models.data_table import (
    DataTable,
    DataTableRecord,
    DataTableRevision,
)

COPY_RECORD_BUDGET = 50000
COPY_BYTE_BUDGET = 16 * 1024 * 1024


async def copy_records(session, table_id, revision):
    result = await session.stream_scalars(
        select(DataTableRecord)
        .where(at_revision(table_id, revision))
        .execution_options(yield_per=200)
    )
    rows, size = [], 0
    async for row in result:
        size += len(json.dumps(row.values, ensure_ascii=False).encode())
        if len(rows) >= COPY_RECORD_BUDGET or size > COPY_BYTE_BUDGET:
            await result.close()
            raise InvalidTable("复制超过 50,000 条记录或 16 MiB 预算，请分批处理")
        rows.append(row)
    return rows


def stage_table(session, note, block_id, definition, source_records):
    definition, copy_values = copy_definition(definition)
    table = DataTable(
        id=new_uuidv7(),
        note_id=note.id,
        workspace_id=note.workspace_id,
        block_id=block_id,
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
    return table, definition
