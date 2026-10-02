from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from orbis_user_api.api.contract import PageData
from orbis_user_api.schemas.user import UserOut
from orbis_user_api.schemas.workspace import WorkspaceOut

SearchType = Literal["document", "notebook", "group", "site", "file"]
SearchTypeFilter = Literal["all", "document", "notebook", "group", "site", "file"]
SearchStatus = Literal["active", "archived", "all"]
SearchScope = Literal["current", "all"]
SearchMatch = Literal["title", "body", "comment", "metadata"]


class SearchWorkspace(BaseModel):
    id: UUID = Field(description="可读工作空间的 UUID")
    name: str = Field(description="工作空间名称")
    is_current: bool = Field(description="是否为账号当前选择的工作空间")


class SearchResolvedScope(BaseModel):
    workspace_ids: list[UUID] = Field(description="本次实际授权并检索的工作空间 ID")
    current_workspace_id: UUID | None = Field(
        description="账号当前空间，搜索不会更改；未设置时为 null"
    )


class SearchItem(BaseModel):
    id: UUID = Field(description="命中的资源 UUID；评论命中使用所属文档 UUID")
    type: SearchType = Field(description="资源类型：文档、文集、分组、站点或文件")
    workspace_id: UUID = Field(description="资源所属工作空间 UUID")
    workspace_name: str = Field(description="资源所属工作空间名称")
    title: str = Field(description="资源标题、名称或文件名")
    location: str = Field(description="资源所属目录或类型位置，不包含私有存储路径")
    snippet: str = Field(
        max_length=240, description="最多 240 字的纯文本命中摘要，不含 HTML"
    )
    match: SearchMatch = Field(
        description="用于该摘要的命中来源；评论合并到所属文档结果"
    )
    matched_comment_id: UUID | None = Field(
        default=None, description="摘要来自评论时的评论 UUID；其他命中为 null"
    )
    status: Literal["active", "archived"] = Field(
        description="资源自身状态；站点和已完成文件固定为 active"
    )
    updated_at_ms: int = Field(
        description="更新时间，毫秒级 Unix 时间戳；文件使用创建时间"
    )
    notebook_id: UUID | None = Field(
        default=None, description="所属文集 UUID；文集结果为自身 ID，其他类型为 null"
    )
    group_id: UUID | None = Field(
        default=None, description="所属分组 UUID；分组结果为自身 ID，无分组资源为 null"
    )


class SearchPage(PageData[SearchItem]):
    scope: SearchResolvedScope = Field(description="实际生效的搜索范围，不改变当前空间")
    workspaces: list[SearchWorkspace] = Field(
        description="当前账号具有读取权限的活跃工作空间"
    )


class WorkspaceSwitchRequest(BaseModel):
    workspace_id: UUID = Field(
        description="用户显式选择并准备打开资源的目标工作空间 UUID"
    )


class WorkspaceSwitchResponse(BaseModel):
    user: UserOut = Field(description="切换后的完整当前用户资料")
    workspace: WorkspaceOut = Field(description="切换后的工作空间及当前成员角色")
