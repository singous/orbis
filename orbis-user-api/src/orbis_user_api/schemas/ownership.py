from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class OwnershipTransferCreateRequest(BaseModel):
    target_member_id: UUID


class OwnershipTransferConfirmRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)


class OwnershipTransferOut(BaseModel):
    id: UUID
    from_user_id: UUID
    target_member_id: UUID
    target_user_id: UUID
    status: str
    expires_at_ms: int
    email_sent: bool
    email_error_summary: str | None
    confirmed_at_ms: int | None
    cancelled_at_ms: int | None
    created_at_ms: int
    updated_at_ms: int
