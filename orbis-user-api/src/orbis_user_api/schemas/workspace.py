from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    workspace_type: str
    role: str
    is_current: bool = False
    created_at_ms: int
    updated_at_ms: int


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceOut]


class WorkspaceCurrentUpdateRequest(BaseModel):
    workspace_id: UUID


class WorkspaceMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    email: EmailStr
    display_name: str | None
    role: str
    status: str
    created_at_ms: int
    updated_at_ms: int


class WorkspaceMemberListResponse(BaseModel):
    items: list[WorkspaceMemberOut]


class WorkspaceMemberCreateRequest(BaseModel):
    email: EmailStr
