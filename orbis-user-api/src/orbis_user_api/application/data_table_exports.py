"""Complete, budgeted exports and immutable public table projections."""

from copy import deepcopy
import csv
import io


from orbis_user_api.application.data_table_query import ordered_query
from orbis_user_api.application.data_tables import definition_at, referenced_table
from orbis_user_api.domain.data_tables import InvalidTable, display_value
from orbis_user_api.models.data_table import DataTable
from orbis_user_api.services.exceptions import NoteNotFound

EXPORT_RECORD_BUDGET = 50000
EXPORT_BYTE_BUDGET = 16 * 1024 * 1024


async def table_projection(session, table_id, revision, *, view_id=None, public=False):
    definition = await definition_at(session, table_id, revision)
    selected = (
        definition.public_view_id if public else view_id or definition.views[0].id
    )
    view = next((view for view in definition.views if view.id == selected), None)
    if view is None:
        raise InvalidTable("导出视图不存在")
    allowed = (
        set(definition.public_field_ids)
        if public
        else {field.id for field in definition.fields}
    )
    fields = [
        next(field for field in definition.fields if field.id == key)
        for key in (view.field_ids or [field.id for field in definition.fields])
        if key in allowed
    ]
    query = ordered_query(table_id, revision, definition, view)
    result = await session.stream_scalars(query.execution_options(yield_per=200))
    rows, size = [], 0
    async for row in result:
        cells = [
            display_value(field, row.values.get(str(field.id))) for field in fields
        ]
        size += sum(len(cell.encode()) for cell in cells)
        if len(rows) >= EXPORT_RECORD_BUDGET or size > EXPORT_BYTE_BUDGET:
            await result.close()
            raise InvalidTable(
                "导出超过 50,000 条记录或 16 MiB 预算，请收窄视图筛选后重试"
            )
        rows.append(cells)
    from orbis_user_api.application.site_sources import digest

    data = {
        "title": definition.title,
        "view": view.name,
        "revision": revision,
        "columns": [field.name for field in fields],
        "rows": rows,
        "total": len(rows),
    }
    return {**data, "digest": digest(data)}


def projection_markdown(data):
    def escape(value):
        return (
            str(value)
            .replace("\\", "\\\\")
            .replace("|", "\\|")
            .replace("\r", "")
            .replace("\n", "<br>")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    lines = [
        f"### {escape(data['title'])}",
        f"视图：{escape(data['view'])}；快照版本：{data['revision']}",
        "",
        "| " + " | ".join(map(escape, data["columns"])) + " |",
        "| " + " | ".join("---" for _ in data["columns"]) + " |",
    ]
    lines.extend("| " + " | ".join(map(escape, row)) + " |" for row in data["rows"])
    return "\n".join(lines)


async def export_table(note, table, session, format, view_id=None):
    block, _, _ = await referenced_table(note, table, session)
    data = await table_projection(
        session, table.id, block["props"]["table_revision"], view_id=view_id
    )
    if format == "markdown":
        return projection_markdown(data)
    output = io.StringIO()
    writer = csv.writer(output)

    def safe(value):
        # Spreadsheet formula interpretation is not part of this text export.
        return (
            "'" + value
            if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r"))
            else value
        )

    writer.writerow([safe(value) for value in data["columns"]])
    writer.writerows([safe(value) for value in row] for row in data["rows"])
    return "\ufeff" + output.getvalue()


async def project_document_tables(blocks, session, note_id, *, public):
    """Materialize only table references authorized by their owning document."""
    result = deepcopy(blocks)

    async def visit(items):
        for block in items:
            if block.get("type") == "dataTable":
                props = block.get("props", {})
                if not props.get("table_id"):
                    block["table_snapshot"] = {
                        "title": props.get("title", "多维表格"),
                        "view": "",
                        "revision": 0,
                        "columns": [],
                        "rows": [],
                    }
                    continue
                from uuid import UUID

                try:
                    table = await session.get(DataTable, UUID(props["table_id"]))
                except (ValueError, TypeError):
                    raise NoteNotFound from None
                if table is None or table.note_id != note_id:
                    raise NoteNotFound
                data = await table_projection(
                    session, table.id, props["table_revision"], public=public
                )
                block["table_snapshot"] = data
                if public:
                    block["props"] = {
                        "title": data["title"],
                        "table_revision": data["revision"],
                    }
            await visit(block.get("children", []))

    await visit(result.get("blocks", []))
    return result
