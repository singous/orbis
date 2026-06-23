from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NoteCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    blocks: dict[str, Any] = Field(default_factory=dict)
    plain_text: str = ""
    note_type: str = Field(default="doc", max_length=32)


class NoteContentUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=240)
    blocks: dict[str, Any]
    plain_text: str = ""


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    owner_id: UUID
    title: str
    note_type: str
    blocks: dict[str, Any]
    plain_text: str
    content_version: int
    status: str
    created_at_ms: int
    updated_at_ms: int


class NoteListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    owner_id: UUID
    title: str
    note_type: str
    plain_text: str
    content_version: int
    status: str
    created_at_ms: int
    updated_at_ms: int


class NoteListResponse(BaseModel):
    items: list[NoteListItem]
