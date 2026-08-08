from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    display_name: str | None
    current_workspace_id: UUID | None
    is_superuser: bool
    status: str
    created_at_ms: int
    updated_at_ms: int
