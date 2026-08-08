from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SourceType = Literal["file", "note_snapshot"]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class IngestionIdentityV1(ContractModel):
    schema_version: Literal[1] = 1
    event_id: UUID
    occurred_at_ms: int = Field(ge=0)
    tenant_id: UUID
    workspace_id: UUID
    knowledge_base_id: UUID
    source_type: SourceType
    source_id: UUID
    source_version_id: UUID
    source_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    processing_job_id: UUID


class IngestionRequestedV1(IngestionIdentityV1):
    storage_key: str = Field(min_length=1, max_length=1024)
    filename: str = Field(min_length=1, max_length=512)
    mime_type: str = Field(min_length=1, max_length=255)


class IngestionChunkV1(ContractModel):
    chunk_id: UUID
    ordinal: int = Field(ge=0)
    text: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    vector: list[float] = Field(min_length=1)


class IngestionProcessedV1(IngestionIdentityV1):
    embedding_configuration_id: str = Field(min_length=1, max_length=255)
    chunks: list[IngestionChunkV1] = Field(min_length=1)
