from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from orbis_user_api.schemas.user import UserOut


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
    items: list[WorkspaceOut] = Field(
        description="当前账号具有读取权限的活跃工作空间列表，不会修改账号默认空间"
    )


class WorkspaceSwitchRequest(BaseModel):
    workspace_id: UUID = Field(
        description="用户在全局空间选择器中显式选择的目标工作空间 UUID"
    )


class WorkspaceSwitchResponse(BaseModel):
    user: UserOut = Field(description="切换后的完整用户资料，包含新的默认工作空间")
    workspace: WorkspaceOut = Field(description="切换后的工作空间及当前成员角色")
