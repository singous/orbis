from __future__ import annotations

from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from orbis_user_api.domain.site import (
    DEFAULT_ACCENT_COLOR,
    MAX_NAVIGATION_PAGES,
    SLUG_PATTERN,
)
from orbis_user_api.schemas.site_source import SiteBranding, SiteSource

SiteKind = Literal["knowledge", "handbook", "help"]


class SiteNavigationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: UUID = Field(description="当前空间中待发布文档的 UUID")
    slug: str = Field(
        min_length=1,
        max_length=100,
        pattern=SLUG_PATTERN,
        description="独立公开页面路径，使用小写英文、数字和连字符",
    )
    title: str = Field(min_length=1, max_length=240, description="独立的导航标题")
    group: str | None = Field(
        default=None, max_length=120, description="导航分组名称；null 表示未分组"
    )

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("导航标题不能为空")
        return value.strip()

    @field_validator("group")
    @classmethod
    def trim_group(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None


class SiteConfig(BaseModel):
    name: str = Field(min_length=1, max_length=160, description="站点名称")
    slug: str = Field(
        min_length=1,
        max_length=80,
        pattern=SLUG_PATTERN,
        description="全局唯一的站点路径，使用小写英文、数字和连字符",
    )
    description: str = Field(default="", max_length=2000, description="站点简介")
    site_kind: SiteKind = Field(
        default="knowledge", description="起始场景：知识站、产品手册或帮助中心"
    )
    accent_color: str = Field(
        default=DEFAULT_ACCENT_COLOR,
        pattern=r"^#[0-9a-fA-F]{6}$",
        description="六位十六进制主题色",
    )
    navigation: list[SiteNavigationItem] = Field(
        default_factory=list,
        max_length=MAX_NAVIGATION_PAGES,
        description="独立公开导航，数组顺序决定页面顺序",
    )
    source: SiteSource = Field(
        default_factory=SiteSource, description="手选文档或关联笔记本来源"
    )
    branding: SiteBranding = Field(
        default_factory=SiteBranding, description="随发布版本固定的品牌与阅读配置"
    )

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("站点名称不能为空")
        return value.strip()

    @model_validator(mode="after")
    def validate_navigation_uniqueness(self) -> Self:
        if len({item.slug for item in self.navigation}) != len(self.navigation):
            raise ValueError("页面路径不能重复")
        if len({item.note_id for item in self.navigation}) != len(self.navigation):
            raise ValueError("同一文档不能重复选择")
        return self


class SiteCreateRequest(SiteConfig):
    model_config = ConfigDict(extra="forbid")


class SiteUpdateRequest(SiteCreateRequest):
    expected_version: int = Field(ge=1, description="当前站点配置版本；过期时返回 409")


class SiteOut(SiteConfig):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    config_version: int
    published_release_id: UUID | None
    published_slug: str | None = Field(
        description="当前公开版本的路径；未发布时为 null，与配置草稿路径独立"
    )
    created_at_ms: int = Field(description="创建时间，UTC Unix 毫秒时间戳")
    updated_at_ms: int = Field(description="更新时间，UTC Unix 毫秒时间戳")


class SitePageOut(BaseModel):
    slug: str
    title: str
    group: str | None
    blocks: dict[str, Any] = Field(description="经过公开安全校验的 v1 或 v2 结构化正文")
    plain_text: str = Field(description="从公开正文派生的纯文本，可用于本快照内搜索")
    parent_slug: str | None = None
    section: str | None = None
    description: str = ""
    updated_at_ms: int | None = None


class SiteSnapshotOut(BaseModel):
    name: str
    slug: str
    description: str
    site_kind: SiteKind
    accent_color: str
    pages: list[SitePageOut]
    branding: SiteBranding = Field(default_factory=SiteBranding)
    redirects: dict[str, str] = Field(default_factory=dict)
    release_id: UUID | None = Field(description="发布版本 UUID；认证预览为 null")
    release_number: int | None = Field(description="递增发布版本号；认证预览为 null")
    published_at_ms: int | None = Field(
        description="发布时间，UTC Unix 毫秒时间戳；认证预览为 null"
    )


class SitePreviewOut(SiteSnapshotOut):
    source_fingerprint: str = Field(
        description="认证预览的来源指纹，发布时用于检测内容变化"
    )


class SiteReleaseOut(BaseModel):
    id: UUID
    release_number: int
    published_at_ms: int = Field(description="发布时间，UTC Unix 毫秒时间戳")
    is_active: bool = Field(description="是否是当前公开版本")
