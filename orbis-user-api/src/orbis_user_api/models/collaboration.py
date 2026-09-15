from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class NoteComment(Base):
    __tablename__ = "note_comments"
    __table_args__ = (
        Index(
            "ix_note_comments_workspace_note_created",
            "workspace_id",
            "note_id",
            "created_at_ms",
        ),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    parent_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    author_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    body: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    is_resolved: Mapped[bool] = mapped_column(
        default=False, server_default=false(), nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class NoteRevision(Base):
    __tablename__ = "note_revisions"
    __table_args__ = (
        UniqueConstraint(
            "note_id", "content_version", name="uq_note_revisions_note_version"
        ),
        Index(
            "ix_note_revisions_workspace_note_version",
            "workspace_id",
            "note_id",
            "content_version",
        ),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    author_id: Mapped[UUID | None] = mapped_column(GUID())
    author_name: Mapped[str] = mapped_column(
        String(120), default="历史版本", server_default="历史版本", nullable=False
    )
    content_version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    blocks: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    plain_text: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
