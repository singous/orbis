"""Immutable public page bodies and indexed release navigation bindings."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class SitePageBody(Base):
    __tablename__ = "site_page_bodies"
    __table_args__ = (
        UniqueConstraint("site_id", "content_digest", name="uq_site_page_body_digest"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    site_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    content_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    blocks: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    plain_text: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    body_bytes: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class SiteReleasePage(Base):
    __tablename__ = "site_release_pages"
    __table_args__ = (
        UniqueConstraint("release_id", "slug", name="uq_site_release_page_slug"),
        Index("ix_site_release_page_order", "release_id", "position"),
        Index("ix_site_release_page_reuse", "site_id", "render_fingerprint"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    site_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    release_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(
        String(100), default="", server_default="", nullable=False
    )
    position: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    body_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    metadata_fields: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    render_fingerprint: Mapped[str] = mapped_column(
        String(64), default="", server_default="", nullable=False
    )
