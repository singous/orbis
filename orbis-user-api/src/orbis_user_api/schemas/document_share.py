from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ShareCreateRequest(BaseModel):
    notebook_id: UUID
    root_note_id: UUID | None = None
    acknowledge_public_scope: bool = Field(
        description="Confirm that the current scope and future descendants become public"
    )


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    notebook_id: UUID
    root_note_id: UUID | None
    created_at_ms: int
    revoked_at_ms: int | None
    path: str | None = None


class ShareCreatedOut(ShareOut):
    token: str = Field(description="Secret returned once; only its digest is stored")
    path: str


class ShareListOut(BaseModel):
    items: list[ShareOut]


class SharedNoteOut(BaseModel):
    id: UUID
    parent_id: UUID | None
    title: str
    sort_order: int
    updated_at_ms: int


class PublicShareOut(BaseModel):
    title: str
    root_note_id: UUID | None
    items: list[SharedNoteOut]


class SharedContentOut(BaseModel):
    note_id: UUID
    title: str
    blocks: dict[str, Any]
    content_version: int
    updated_at_ms: int
    offset: int
    next_offset: int
    total_blocks: int
    has_more: bool
    descriptors: list[dict[str, Any]] = Field(default_factory=list)
    returned_bytes: int = 0
    oversized_block: bool = False
    parent_id: str | None = None
