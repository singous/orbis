"""Body-free navigation and independently versioned public delivery models."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut


class SitePageMetadata(BaseModel):
    slug: str = Field(description="公开页面路径，可含层级分隔符")
    title: str = Field(description="公开页面标题")
    group: str | None = Field(description="导航分组名称")
    parent_slug: str | None = Field(default=None, description="父页面路径")
    section: str | None = Field(default=None, description="顶部分区名称")
    description: str = Field(default="", description="公开页面简介")
    updated_at_ms: int | None = Field(
        default=None, description="更新时间，UTC Unix 毫秒时间戳"
    )


class SiteManifestOut(SiteSnapshotOut):
    canonical_base_url: str = Field(
        description="由部署配置派生的站点绝对规范根地址，不使用请求 Host"
    )
    pages: list[SitePageMetadata] = Field(
        description="有序导航元数据，不包含正文或搜索文本"
    )


class SitePageDeliveryOut(BaseModel):
    release_id: UUID = Field(description="当前公开发布版本 UUID")
    page: SitePageOut = Field(description="此版本的单个公开页面")


class SiteSearchPage(SitePageMetadata):
    plain_text: str = Field(
        description="包含所有标签页与示例的公开搜索文本，不包含结构化正文"
    )


class SiteSearchOut(BaseModel):
    release_id: UUID = Field(description="当前公开发布版本 UUID")
    pages: list[SiteSearchPage] = Field(description="此版本全部页面的轻量搜索索引")
