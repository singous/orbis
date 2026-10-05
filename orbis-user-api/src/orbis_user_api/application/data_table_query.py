"""Database-side table filtering, ordering and bounded projection."""

from sqlalchemy import and_, cast, func, or_, select, String
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.domain.data_tables import InvalidTable
from orbis_user_api.models.data_table import DataTableRecord as Record
from orbis_user_api.schemas.data_table import TableDefinition, TableField, TableView


def at_revision(table_id, revision: int):
    return and_(
        Record.table_id == table_id,
        Record.valid_from <= revision,
        or_(Record.valid_to.is_(None), Record.valid_to > revision),
    )


def scalar_value(field: TableField):
    value = Record.values[str(field.id)]
    if field.kind in {"number", "datetime"}:
        return value.as_float()
    if field.kind == "checkbox":
        return value.as_boolean()
    return value.as_string()


def query_conditions(definition: TableDefinition, view: TableView):
    fields = {field.id: field for field in definition.fields}
    result = []
    for item in view.filters:
        field = fields[item.field_id]
        value = scalar_value(field)
        empty = value.is_(None)
        if field.kind in {"text", "url", "select"}:
            empty = or_(empty, value == "")
        elif field.kind == "multi_select":
            empty = or_(empty, cast(value, String) == "[]")
        if item.operator == "empty":
            result.append(empty)
        elif item.operator == "not_empty":
            result.append(~empty)
        elif item.operator == "contains":
            # UUID option values cannot contain quote or escape characters.
            text = f'"{item.value}"' if field.kind == "multi_select" else item.value
            result.append(cast(value, String).contains(text, autoescape=True))
        else:
            methods = {
                "eq": "__eq__",
                "ne": "__ne__",
                "gt": "__gt__",
                "gte": "__ge__",
                "lt": "__lt__",
                "lte": "__le__",
            }
            result.append(getattr(value, methods[item.operator])(item.value))
    return result


def ordered_query(
    table_id, revision: int, definition: TableDefinition, view: TableView
):
    fields = {field.id: field for field in definition.fields}
    ordering = []
    if view.kind == "grid" and view.group_field_id:
        ordering.append(scalar_value(fields[view.group_field_id]).asc().nulls_last())
    for item in view.sorts:
        value = scalar_value(fields[item.field_id])
        ordering.append((value.desc() if item.descending else value.asc()).nulls_last())
    ordering.append(Record.record_id.asc())
    return (
        select(Record)
        .where(at_revision(table_id, revision), *query_conditions(definition, view))
        .order_by(*ordering)
    )


async def record_page(
    session: AsyncSession,
    table_id,
    revision: int,
    definition: TableDefinition,
    view: TableView,
    offset: int,
    limit: int,
    *,
    group: str | None = None,
):
    conditions = [at_revision(table_id, revision), *query_conditions(definition, view)]
    query = ordered_query(table_id, revision, definition, view)
    groups = []
    if view.group_field_id:
        field = next(
            field for field in definition.fields if field.id == view.group_field_id
        )
        value = scalar_value(field)
        counts = await session.execute(
            select(value, func.count()).where(*conditions).group_by(value)
        )
        count_map = {key: count for key, count in counts}
        groups = [{"id": None, "name": "未分组", "count": count_map.get(None, 0)}] + [
            {"id": str(o.id), "name": o.label, "count": count_map.get(str(o.id), 0)}
            for o in field.options
        ]
        if group is not None:
            if group != "__empty__" and group not in {str(o.id) for o in field.options}:
                raise InvalidTable("分组值不存在")
            condition = value.is_(None) if group == "__empty__" else value == group
            conditions.append(condition)
            query = query.where(condition)
    total = int(
        await session.scalar(
            select(func.count()).select_from(Record).where(*conditions)
        )
        or 0
    )
    rows = list(await session.scalars(query.offset(offset).limit(limit)))
    known = {str(field.id) for field in definition.fields}
    records = [
        {
            "id": str(row.record_id),
            "values": {key: value for key, value in row.values.items() if key in known},
        }
        for row in rows
    ]
    return {
        "records": records,
        "total": total,
        "offset": offset,
        "next_offset": offset + len(rows),
        "has_more": offset + len(rows) < total,
        "groups": groups,
    }
