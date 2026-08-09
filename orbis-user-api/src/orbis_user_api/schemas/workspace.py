from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    workspace_type: str
    role: str
    is_current: bool = False
    created_at_ms: int
    updated_at_ms: int
