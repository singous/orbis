from __future__ import annotations

from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator

from orbis_user_api.schemas.user import UserOut
from orbis_user_api.schemas.workspace import WorkspaceOut


class SetupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> str:
        return str(value).strip().lower()

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be blank")
        return normalized


class SetupResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
    workspace: WorkspaceOut
