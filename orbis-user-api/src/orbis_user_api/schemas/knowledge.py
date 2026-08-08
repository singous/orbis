from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)


class KnowledgeBaseUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)


class KnowledgeBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    workspace_id: UUID
    owner_id: UUID
    name: str
    description: str
    status: str
    deletion_error_summary: str | None
    created_at_ms: int
    updated_at_ms: int


class KnowledgeBaseListResponse(BaseModel):
    items: list[KnowledgeBaseOut]


class SourceIntakeAccepted(BaseModel):
    source_id: UUID
    source_version_id: UUID
    processing_job_id: UUID
    source_type: Literal["file", "note_snapshot"]
    source_hash: str
    version_number: int
    processing_status: str


class KnowledgeSourceOut(BaseModel):
    id: UUID
    knowledge_base_id: UUID
    source_type: Literal["file", "note_snapshot"]
    source_note_id: UUID | None
    filename: str
    mime_type: str
    source_hash: str
    current_version_number: int
    status: str
    deletion_error_summary: str | None
    processing_job_id: UUID
    processing_status: str
    error_summary: str | None
    created_at_ms: int
    updated_at_ms: int


class KnowledgeSourceListResponse(BaseModel):
    items: list[KnowledgeSourceOut]


class ProcessingJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    workspace_id: UUID
    knowledge_base_id: UUID
    source_type: Literal["file", "note_snapshot"]
    source_id: UUID
    source_version_id: UUID
    source_hash: str
    status: str
    attempt_count: int
    error_summary: str | None
    created_at_ms: int
    updated_at_ms: int
