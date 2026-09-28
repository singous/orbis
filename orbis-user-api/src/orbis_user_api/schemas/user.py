from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    email: EmailStr
    display_name: str | None
    bio: str | None = None
    avatar_file_id: UUID | None = None
    current_workspace_id: UUID | None
    status: str
    created_at_ms: int
    updated_at_ms: int


class UserProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    bio: str | None = Field(default=None, max_length=500)


class UserAvatarOut(BaseModel):
    data_url: str
