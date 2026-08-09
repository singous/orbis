from __future__ import annotations

from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator

from orbis_user_api.schemas.user import UserOut
from orbis_user_api.schemas.workspace import WorkspaceOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> str:
        return str(value).strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=16)


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
    workspace: WorkspaceOut | None


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
