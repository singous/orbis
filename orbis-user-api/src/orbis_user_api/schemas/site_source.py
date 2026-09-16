from __future__ import annotations

from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from orbis_user_api.domain.site import (
    MAX_NAVIGATION_PAGES,
    MAX_PAGE_SLUG_LENGTH,
    MAX_SITE_LINKS,
    PAGE_SLUG_PATTERN,
)


class NotebookSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notebook_id: UUID
    root_note_id: UUID | None = None
    label: str | None = Field(default=None, max_length=160)

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None


class SitePageOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: UUID
    title: str | None = Field(default=None, max_length=240)
    slug: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_PAGE_SLUG_LENGTH,
        pattern=PAGE_SLUG_PATTERN,
    )
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("title", "description")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None


class SiteSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["manual", "notebooks"] = "manual"
    notebooks: list[NotebookSource] = Field(
        default_factory=list, max_length=MAX_NAVIGATION_PAGES
    )
    excluded_note_ids: list[UUID] = Field(default_factory=list)
    page_overrides: list[SitePageOverride] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_bindings(self) -> Self:
        if self.kind == "notebooks" and not self.notebooks:
            raise ValueError("请选择至少一个来源笔记本")
        if self.kind == "manual" and self.notebooks:
            raise ValueError("手选模式不能同时绑定笔记本")
        ids = [entry.note_id for entry in self.page_overrides]
        if len(set(ids)) != len(ids):
            raise ValueError("同一文档只能配置一组覆盖项")
        return self


class SiteLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("链接名称不能为空")
        return value.strip()


class SiteBranding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    logo_url: str | None = Field(default=None, max_length=2048)
    links: list[SiteLink] = Field(default_factory=list, max_length=MAX_SITE_LINKS)
    footer_links: list[SiteLink] = Field(
        default_factory=list, max_length=MAX_SITE_LINKS
    )
    cta: SiteLink | None = None
    theme: Literal["system", "light", "dark"] = "system"


class SiteSourcePage(BaseModel):
    note_id: UUID
    slug: str
    title: str
    group: str | None = None
    parent_slug: str | None = None
    section: str | None = None
    description: str = ""
    updated_at_ms: int | None = None


class SiteChangePage(SiteSourcePage):
    note_id: UUID | None = Field(
        description="来源文档标识；旧发布版无法还原的已移除页面为 null"
    )


class SiteChanges(BaseModel):
    added: list[SiteChangePage] = Field(default_factory=list)
    modified: list[SiteChangePage] = Field(default_factory=list)
    removed: list[SiteChangePage] = Field(default_factory=list)


class SiteSourcesOut(BaseModel):
    pages: list[SiteSourcePage]
    excluded_count: int
    source_fingerprint: str
    changes: SiteChanges


class SitePublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_source_fingerprint: str | None = Field(
        default=None, pattern=r"^[a-f0-9]{64}$"
    )
