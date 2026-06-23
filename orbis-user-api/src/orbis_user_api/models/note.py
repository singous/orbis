from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_owner_updated", "owner_id", "updated_at_ms"),
        Index("ix_notes_workspace_updated", "workspace_id", "updated_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("workspaces.id"), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    note_type: Mapped[str] = mapped_column(String(32), default="doc", nullable=False)
    blocks: Mapped[dict[str, Any]] = mapped_column(json_type, default=dict, nullable=False)
    plain_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    content_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)


class NoteRevision(Base):
    __tablename__ = "note_revisions"
    __table_args__ = (UniqueConstraint("note_id", "version", name="uq_note_revisions_note_version"),)

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("notes.id"), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    blocks: Mapped[dict[str, Any]] = mapped_column(json_type, nullable=False)
    plain_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
