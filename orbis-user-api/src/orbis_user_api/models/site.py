from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type
from orbis_user_api.domain.site import DEFAULT_ACCENT_COLOR


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        Index("ix_sites_workspace_updated", "workspace_id", "updated_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    name: Mapped[str] = mapped_column(
        String(160), default="", server_default="", nullable=False
    )
    slug: Mapped[str] = mapped_column(
        String(80), unique=True, default="", server_default="", nullable=False
    )
    description: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    site_kind: Mapped[str] = mapped_column(
        String(32), default="knowledge", server_default="knowledge", nullable=False
    )
    accent_color: Mapped[str] = mapped_column(
        String(7),
        default=DEFAULT_ACCENT_COLOR,
        server_default=DEFAULT_ACCENT_COLOR,
        nullable=False,
    )
    navigation: Mapped[list[dict[str, Any]]] = mapped_column(
        json_type, default=list, server_default="[]", nullable=False
    )
    config_version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    release_sequence: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    published_release_id: Mapped[UUID | None] = mapped_column(GUID())
    published_slug: Mapped[str | None] = mapped_column(String(80), unique=True)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class SiteRelease(Base):
    __tablename__ = "site_releases"
    __table_args__ = (
        UniqueConstraint(
            "site_id", "release_number", name="uq_site_releases_site_number"
        ),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    site_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    release_number: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    published_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class SiteSlugReservation(Base):
    """One namespace for both draft and currently published site paths."""

    __tablename__ = "site_slug_reservations"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    site_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(
        String(80), unique=True, default="", server_default="", nullable=False
    )
