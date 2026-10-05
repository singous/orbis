"""Preserve references on round trips and materialize authorized independent copies."""

from uuid import UUID


from orbis_user_api.application.data_table_creation import copy_records, stage_table
from orbis_user_api.models.data_table import (
    DataTable,
)
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)


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
            rows = await copy_records(session, table.id, revision)
            copied, definition = stage_table(
                session, note, block["id"], definition, rows
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
