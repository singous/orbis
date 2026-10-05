"""Preserve references on round trips and materialize authorized independent copies."""

from uuid import UUID

from sqlalchemy import select

from orbis_user_api.application.data_table_query import at_revision
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.domain.data_table_copy import copy_definition
from orbis_user_api.models.data_table import (
    DataTable,
    DataTableRecord,
    DataTableRevision,
)
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

COPY_BUDGET = 50000


async def prepare_table_references(session, note, user, blocks, *, allow_copy):
    from orbis_user_api.application.data_tables import (
        authorize_table,
        definition_at,
        table_block,
    )

    rewritten = []
    for block in blocks:
        if block.get("type") != "dataTable":
            continue
        props = block.get("props", {})
        if not props.get("table_id"):
            if props.get("table_revision", 0) != 0:
                raise NoteContentInvalid
            continue
        try:
            table = await session.get(DataTable, UUID(props["table_id"]))
            if not table:
                raise NoteContentInvalid
            revision = props.get("table_revision", 0)
            definition = await definition_at(session, table.id, revision)
            if (
                table.note_id == note.id
                and table.workspace_id == note.workspace_id
                and table.block_id == block["id"]
            ):
                continue
            # Integration callers must preserve references. Copying a source
            # outside an integration's explicit scope is never inferred here.
            if not allow_copy:
                raise NoteContentInvalid
            await authorize_table(table.note_id, table.id, user, session)
            rows = list(
                await session.scalars(
                    select(DataTableRecord)
                    .where(at_revision(table.id, revision))
                    .limit(COPY_BUDGET + 1)
                )
            )
            if len(rows) > COPY_BUDGET:
                raise NoteContentInvalid
            definition, copy_values = copy_definition(definition)
            copied = DataTable(
                id=new_uuidv7(),
                note_id=note.id,
                workspace_id=note.workspace_id,
                block_id=block["id"],
                head_revision=1,
            )
            session.add(copied)
            session.add(
                DataTableRevision(
                    table_id=copied.id,
                    revision=1,
                    definition=definition.model_dump(mode="json"),
                )
            )
            session.add_all(
                DataTableRecord(
                    table_id=copied.id,
                    record_id=new_uuidv7(),
                    valid_from=1,
                    values=copy_values(row.values),
                )
                for row in rows
            )
            replacement = table_block(block, copied.id, 1, definition)
            block["props"] = replacement["props"]
            rewritten.append(replacement)
        except (
            ValueError,
            TypeError,
            NoteNotFound,
            UserWorkspaceMissing,
            WorkspaceMemberForbidden,
        ):
            raise NoteContentInvalid from None
    return rewritten
