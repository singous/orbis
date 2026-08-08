from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class NoteGroup(Base):
    __tablename__ = "note_groups"
    __table_args__ = (
        Index("ix_note_groups_workspace_sort", "workspace_id", "sort_order"),
        Index("ix_note_groups_owner_created", "owner_id", "created_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        default=False, server_default=false(), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class Notebook(Base):
    __tablename__ = "notebooks"
    __table_args__ = (
        Index("ix_notebooks_workspace_sort", "workspace_id", "sort_order"),
        Index("ix_notebooks_group_sort", "group_id", "sort_order"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    group_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_owner_updated", "owner_id", "updated_at_ms"),
        Index("ix_notes_workspace_updated", "workspace_id", "updated_at_ms"),
        Index(
            "ix_notes_notebook_parent_sort", "notebook_id", "parent_id", "sort_order"
        ),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    notebook_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    parent_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    note_type: Mapped[str] = mapped_column(
        String(32), default="doc", server_default="doc", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class NoteContent(Base):
    __tablename__ = "note_contents"
    __table_args__ = (UniqueConstraint("note_id", name="uq_note_contents_note_id"),)

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    blocks: Mapped[dict[str, Any]] = mapped_column(
        json_type, server_default="{}", nullable=False
    )
    plain_text: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    content_version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
