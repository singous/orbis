from __future__ import annotations

from typing import Any, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from orbis_user_api.schemas.notebook_icon import NotebookIcon

ResourceStatus: TypeAlias = Literal["active", "archived"]


class NoteCreateRequest(BaseModel):
    notebook_id: UUID
    title: str = Field(min_length=1, max_length=240)
    parent_id: UUID | None = None
    sort_order: int = 0


class NoteMetadataUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    parent_id: UUID | None = None
    sort_order: int | None = None


class NoteOrderRequest(BaseModel):
    parent_id: UUID | None = None
    expected_note_ids: list[UUID] = Field(min_length=1)
    note_ids: list[UUID] = Field(min_length=1)


class NoteContentUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    blocks: dict[str, Any]


class NoteContentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    note_id: UUID
    blocks: dict[str, Any]
    plain_text: str
    content_version: int
    created_at_ms: int
    updated_at_ms: int


class NoteContentPageOut(BaseModel):
    note_id: UUID
    blocks: dict[str, Any]
    content_version: int
    created_at_ms: int
    updated_at_ms: int
    offset: int
    next_offset: int = Field(
        description="同一 content_version 快照下继续读取的根块偏移量"
    )
    total_blocks: int = Field(description="此内容快照包含的顶层根块总数")
    has_more: bool
    storage_format: Literal["blocks", "legacy"] = "legacy"


class NoteBlockDescriptor(BaseModel):
    id: str
    parent_id: str | None
    child_count: int
    has_children: bool
    children_loaded: bool
    payload_loaded: bool = True
    payload_bytes: int = 0


class NoteChildrenPageOut(NoteContentPageOut):
    parent_id: str | None
    descriptors: list[NoteBlockDescriptor]
    returned_bytes: int
    oversized_block: bool


class NoteBlockOut(BaseModel):
    note_id: UUID
    content_version: int
    block: dict[str, Any]
    descriptor: NoteBlockDescriptor


class NoteContentPrefixRequest(BaseModel):
    expected_version: int = Field(ge=1)
    loaded_block_ids: list[str] = Field(
        description="读取时已载入前缀的原始根块 ID 顺序，删除或新增后的 ID 不应替换此基线"
    )
    blocks: dict[str, Any] = Field(
        description="编辑后的已载入前缀，schema_version=2；服务端保留未载入尾部"
    )


class NoteContentPrefixOut(BaseModel):
    note_id: UUID
    content_version: int
    loaded_block_ids: list[str]
    total_blocks: int
    updated_at_ms: int


class NoteOutlineItemOut(BaseModel):
    id: str
    text: str
    level: int
    root_index: int = Field(description="标题在指定内容快照中的零基根块位置")


class NoteContentOutlineOut(BaseModel):
    content_version: int
    items: list[NoteOutlineItemOut]


class NoteBlockMove(BaseModel):
    id: str = Field(min_length=1, max_length=512)
    parent_id: str | None = None
    after_id: str | None = Field(
        default=None, description="同一父块内的前一个兄弟块 ID；null 表示放到最前"
    )


class NoteBlockChangesRequest(BaseModel):
    expected_version: int = Field(ge=1)
    upserts: list[dict[str, Any]] = Field(
        default_factory=list,
        description="新增或修改块的浅层数据，不允许携带 children 子树",
    )
    moves: list[NoteBlockMove] = Field(default_factory=list)
    deletes: list[str] = Field(
        default_factory=list, description="删除块 ID；未被移出的后代随父块删除"
    )


class NoteBlockChangesOut(BaseModel):
    note_id: UUID
    content_version: int
    total_blocks: int
    updated_at_ms: int
    table_blocks: list[dict[str, Any]] = Field(default_factory=list)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    owner_id: UUID
    notebook_id: UUID | None
    parent_id: UUID | None
    sort_order: int
    title: str
    note_type: str
    status: str
    created_at_ms: int
    updated_at_ms: int


class NoteListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    owner_id: UUID
    notebook_id: UUID | None
    parent_id: UUID | None
    sort_order: int
    title: str
    note_type: str
    status: str
    created_at_ms: int
    updated_at_ms: int


class NoteListResponse(BaseModel):
    items: list[NoteListItem]


class DocumentGroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0


class DocumentGroupUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None


class DocumentGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    owner_id: UUID
    name: str
    is_default: bool
    sort_order: int
    status: str
    created_at_ms: int
    updated_at_ms: int


class DocumentGroupListResponse(BaseModel):
    items: list[DocumentGroupOut]


class NotebookCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    group_id: UUID | None = None
    sort_order: int = 0
    icon: NotebookIcon | None = Field(
        default=None,
        description="笔记本图标：内置图标及配色，或当前工作空间已上传的自定义图片；省略或 null 使用默认图标。",
    )


class NotebookUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    group_id: UUID | None = None
    sort_order: int | None = None
    icon: NotebookIcon | None = Field(
        default=None, description="笔记本图标；省略保持原值，显式 null 恢复默认图标。"
    )


class NotebookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    group_id: UUID
    owner_id: UUID
    title: str
    icon: NotebookIcon | None = Field(
        default=None,
        description="笔记本图标配置；历史记录或默认图标返回 null。自定义图片须通过鉴权图标接口读取。",
    )
    sort_order: int
    status: str
    created_at_ms: int
    updated_at_ms: int


class NotebookListResponse(BaseModel):
    items: list[NotebookOut]


class MarkdownImportRequest(BaseModel):
    notebook_id: UUID
    title: str = Field(min_length=1, max_length=240)
    markdown: str
    parent_id: UUID | None = None
    sort_order: int = 0


class MarkdownExportResponse(BaseModel):
    filename: str
    markdown: str


class NoteSearchItem(NoteListItem):
    plain_text: str


class NoteSearchResponse(BaseModel):
    items: list[NoteSearchItem]


class NoteTreeItem(BaseModel):
    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    notebook_id: UUID
    parent_id: UUID | None
    owner_id: UUID
    title: str
    sort_order: int
    status: str
    created_at_ms: int
    updated_at_ms: int
    children: list[NoteTreeItem] = Field(default_factory=list)


class NoteTreeResponse(BaseModel):
    items: list[NoteTreeItem]
