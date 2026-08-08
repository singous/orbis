from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NoteCreateRequest(BaseModel):
    notebook_id: UUID
    title: str = Field(min_length=1, max_length=240)
    parent_id: UUID | None = None
    sort_order: int = 0


class NoteMetadataUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    parent_id: UUID | None = None
    sort_order: int | None = None


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


class NotebookUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    group_id: UUID | None = None
    sort_order: int | None = None


class NotebookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    workspace_id: UUID
    group_id: UUID
    owner_id: UUID
    title: str
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
