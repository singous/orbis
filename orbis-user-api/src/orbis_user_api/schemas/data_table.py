"""Typed table operations. All datetime values are Unix milliseconds."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from orbis_user_api.core.ids import new_uuidv7

MAX_FIELDS = 64
MAX_VIEWS = 24
MAX_BATCH_RECORDS = 100
MAX_PAGE_RECORDS = 200


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SelectOption(StrictModel):
    id: UUID = Field(default_factory=new_uuidv7)
    label: str = Field(min_length=1, max_length=120)
    color: Literal["gray", "blue", "green", "amber", "red", "purple"] = "gray"


class TableField(StrictModel):
    id: UUID = Field(default_factory=new_uuidv7)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal[
        "text", "number", "select", "multi_select", "datetime", "checkbox", "url"
    ] = "text"
    options: list[SelectOption] = Field(default_factory=list, max_length=100)


class TableFilter(StrictModel):
    field_id: UUID
    operator: Literal[
        "eq", "ne", "contains", "empty", "not_empty", "gt", "gte", "lt", "lte"
    ] = "eq"
    value: Any = None


class TableSort(StrictModel):
    field_id: UUID
    descending: bool = False


class TableView(StrictModel):
    id: UUID = Field(default_factory=new_uuidv7)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["grid", "kanban"] = "grid"
    field_ids: list[UUID] = Field(default_factory=list, max_length=MAX_FIELDS)
    widths: dict[str, int] = Field(default_factory=dict)
    filters: list[TableFilter] = Field(default_factory=list, max_length=20)
    sorts: list[TableSort] = Field(default_factory=list, max_length=8)
    group_field_id: UUID | None = None


class TableDefinition(StrictModel):
    title: str = Field(default="多维表格", min_length=1, max_length=240)
    fields: list[TableField] = Field(min_length=1, max_length=MAX_FIELDS)
    views: list[TableView] = Field(min_length=1, max_length=MAX_VIEWS)
    public_view_id: UUID
    public_field_ids: list[UUID] = Field(min_length=1, max_length=MAX_FIELDS)


class TableCreate(StrictModel):
    operation_id: UUID
    expected_document_version: int = Field(ge=1)
    block_id: str = Field(min_length=1, max_length=120)
    source_table_id: UUID | None = None
    source_revision: int | None = Field(default=None, ge=1)


class RecordUpsert(StrictModel):
    id: UUID = Field(default_factory=new_uuidv7)
    values: dict[str, Any] = Field(default_factory=dict)


class TableMutation(StrictModel):
    operation_id: UUID
    block_id: str | None = Field(default=None, min_length=1, max_length=120)
    expected_document_version: int = Field(ge=1)
    expected_table_revision: int = Field(ge=1)
    definition: TableDefinition | None = None
    upserts: list[RecordUpsert] = Field(
        default_factory=list, max_length=MAX_BATCH_RECORDS
    )
    deletes: list[UUID] = Field(default_factory=list, max_length=MAX_BATCH_RECORDS)


class TableMutationOut(BaseModel):
    content_version: int
    table_revision: int
    table_id: UUID
    block: dict[str, Any]
    inverse: dict[str, Any]


class TablePage(BaseModel):
    table_id: UUID
    block_id: str
    revision: int
    content_version: int
    definition: TableDefinition
    view_id: UUID
    records: list[dict[str, Any]]
    total: int
    offset: int
    next_offset: int
    has_more: bool
    groups: list[dict[str, Any]]


class PublishedTablePage(BaseModel):
    snapshot_id: UUID
    title: str
    view: str
    revision: int
    columns: list[str]
    rows: list[list[str]]
    total: int
    offset: int
    next_offset: int
    has_more: bool
    release_id: UUID | None = None
