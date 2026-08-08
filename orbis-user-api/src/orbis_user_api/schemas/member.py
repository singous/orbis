from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from orbis_user_api.schemas.user import UserOut

WorkspaceRole = Literal["owner", "admin", "editor", "normal"]
InvitableRole = Literal["admin", "editor", "normal"]


class InvitationCreateRequest(BaseModel):
    email: EmailStr
    role: InvitableRole
    expires_in_seconds: int | None = Field(default=None, ge=60)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> str:
        return str(value).strip().lower()


class InvitationOut(BaseModel):
    id: UUID
    email: EmailStr
    role: InvitableRole
    status: str
    expires_at_ms: int
    email_sent: bool
    email_error_summary: str | None
    created_at_ms: int
    updated_at_ms: int


class InvitationListResponse(BaseModel):
    items: list[InvitationOut]


class InvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    password: str | None = Field(default=None, min_length=8, max_length=256)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be blank")
        return normalized


class MemberOut(BaseModel):
    id: UUID
    user_id: UUID
    email: EmailStr
    display_name: str | None
    role: WorkspaceRole
    status: str
    created_at_ms: int
    updated_at_ms: int


class MemberListResponse(BaseModel):
    items: list[MemberOut]


class MemberRoleUpdateRequest(BaseModel):
    role: InvitableRole


class InvitationAcceptResponse(BaseModel):
    user: UserOut
    membership: MemberOut
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"


class MailStatusOut(BaseModel):
    available: bool
    transport: Literal["disabled", "outbox", "smtp"]
