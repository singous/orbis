from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    owner_id: UUID
    storage_key: str
    original_filename: str
    mime_type: str
    file_size: int
    sha256: str
    upload_status: str
    created_at_ms: int


class FileListResponse(BaseModel):
    items: list[FileOut]
