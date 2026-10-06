"""Pure field validation and display projection for document-owned tables."""

import math
from typing import Any
from urllib.parse import urlsplit

from orbis_user_api.schemas.data_table import TableDefinition, TableField, TableView

MAX_CELL_TEXT = 8192
MIN_COLUMN_WIDTH = 100
MAX_COLUMN_WIDTH = 600


class InvalidTable(ValueError):
    pass


def validate_value(field: TableField, value: Any) -> Any:
    if value is None:
        return None
    kind = field.kind
    valid = False
    if kind in {"text", "url"}:
        valid = isinstance(value, str) and len(value) <= MAX_CELL_TEXT
        if valid and kind == "url" and value:
            try:
                url = urlsplit(value)
                valid = url.scheme in {"http", "https", "mailto"} and bool(
                    url.netloc or (url.scheme == "mailto" and url.path)
                )
            except ValueError:
                valid = False
    elif kind == "number":
        try:
            valid = type(value) in {int, float} and math.isfinite(value)
        except OverflowError:
            valid = False
    elif kind == "datetime":
        valid = type(value) is int and -62135596800000 <= value <= 253402300799999
    elif kind == "checkbox":
        valid = type(value) is bool
    elif kind == "select":
        valid = isinstance(value, str) and value in {
            str(option.id) for option in field.options
        }
    elif kind == "multi_select":
        valid = isinstance(value, list) and all(isinstance(item, str) for item in value)
        valid = (
            valid
            and len(value) == len(set(value))
            and set(value) <= {str(option.id) for option in field.options}
        )
    if not valid:
        raise InvalidTable(f"字段“{field.name}”的值不符合 {kind} 类型")
    return value


def validate_definition(
    value: TableDefinition, previous: TableDefinition | None = None
) -> None:
    fields = {field.id: field for field in value.fields}
    views = {view.id: view for view in value.views}
    if len(fields) != len(value.fields) or len(views) != len(value.views):
        raise InvalidTable("字段和视图标识不能重复")
    if (
        value.public_view_id not in views
        or not set(value.public_field_ids) <= fields.keys()
    ):
        raise InvalidTable("公开视图或字段无效")
    for field in value.fields:
        if len({option.id for option in field.options}) != len(field.options):
            raise InvalidTable("选项标识不能重复")
        if field.kind not in {"select", "multi_select"} and field.options:
            raise InvalidTable("该字段类型不支持选项")
    if previous:
        old = {field.id: field for field in previous.fields}
        for field in value.fields:
            if field.id in old and old[field.id].kind != field.kind:
                raise InvalidTable("已有字段的类型不可直接转换，请新建字段")
    for view in value.views:
        if (
            len(set(view.field_ids)) != len(view.field_ids)
            or not set(view.field_ids) <= fields.keys()
        ):
            raise InvalidTable("视图字段无效")
        if any(
            key not in {str(field) for field in fields}
            or type(width) is not int
            or not MIN_COLUMN_WIDTH <= width <= MAX_COLUMN_WIDTH
            for key, width in view.widths.items()
        ):
            raise InvalidTable("列宽必须在 100 至 600 像素之间")
        if view.group_field_id is not None and (
            view.group_field_id not in fields
            or fields[view.group_field_id].kind != "select"
        ):
            raise InvalidTable("分组字段必须是单选字段")
        for item in view.sorts:
            if item.field_id not in fields:
                raise InvalidTable("排序字段不存在")
        for item in view.filters:
            field = fields.get(item.field_id)
            if not field:
                raise InvalidTable("筛选字段不存在")
            if item.operator in {"empty", "not_empty"}:
                continue
            if item.operator in {"gt", "gte", "lt", "lte"} and field.kind not in {
                "number",
                "datetime",
            }:
                raise InvalidTable("大小筛选仅支持数字和日期")
            if item.operator in {"gt", "gte", "lt", "lte"} and item.value is None:
                raise InvalidTable("大小筛选必须提供数字或日期值")
            if item.operator == "contains":
                if field.kind not in {"text", "url", "multi_select"} or not isinstance(
                    item.value, str
                ):
                    raise InvalidTable("包含筛选需要文本或多选值")
                if field.kind == "multi_select" and item.value not in {
                    str(option.id) for option in field.options
                }:
                    raise InvalidTable("多选筛选值必须是有效的选项")
            else:
                if field.kind == "multi_select":
                    raise InvalidTable("多选字段支持包含、为空和不为空筛选")
                validate_value(field, item.value)


def default_definition() -> TableDefinition:
    title = TableField(name="标题")
    status = TableField(
        name="状态",
        kind="select",
        options=[
            {"label": "待开始", "color": "gray"},
            {"label": "进行中", "color": "blue"},
            {"label": "已完成", "color": "green"},
        ],
    )
    due = TableField(name="截止时间", kind="datetime")
    ids = [title.id, status.id, due.id]
    grid = TableView(name="全部记录", field_ids=ids)
    board = TableView(
        name="按状态", kind="kanban", field_ids=ids, group_field_id=status.id
    )
    return TableDefinition(
        fields=[title, status, due],
        views=[grid, board],
        public_view_id=grid.id,
        public_field_ids=ids,
    )


def display_value(field: TableField, value: Any) -> str:
    if value is None:
        return ""
    options = {str(option.id): option.label for option in field.options}
    if field.kind == "select":
        return options.get(value, "")
    if field.kind == "multi_select":
        return ", ".join(options.get(item, "") for item in value)
    if field.kind == "checkbox":
        return "是" if value else "否"
    if field.kind == "datetime":
        from datetime import datetime, timedelta, timezone

        return datetime.fromtimestamp(
            value / 1000, timezone(timedelta(hours=8))
        ).isoformat(timespec="minutes")
    return str(value)
