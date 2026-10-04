from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class NoteBlockDocument(Base):
    """The presence of this header selects block records as the content authority."""

    __tablename__ = "note_block_documents"
    __table_args__ = (UniqueConstraint("note_id"),)
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    content_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    root_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )


class NoteBlockSnapshot(Base):
    """A compact version marker; content lives in versioned block records."""

    __tablename__ = "note_block_snapshots"
    __table_args__ = (UniqueConstraint("note_id", "content_version"),)
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    content_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    source_schema: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    root_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )


class NoteBlockVersion(Base):
    """One block per row, with a half-open document-version validity interval.

    External block IDs are preserved, including legacy non-UUID IDs. The row's
    independent primary key is an application-generated UUIDv7.
    """

    __tablename__ = "note_block_versions"
    __table_args__ = (
        UniqueConstraint("note_id", "block_id", "valid_from"),
        Index(
            "ix_note_blocks_current_roots",
            "note_id",
            "position",
            "block_id",
            postgresql_where=text("valid_to IS NULL AND parent_id IS NULL"),
            sqlite_where=text("valid_to IS NULL AND parent_id IS NULL"),
        ),
        Index(
            "ix_note_blocks_current_siblings",
            "note_id",
            "parent_id",
            "position",
            "block_id",
            postgresql_where=text("valid_to IS NULL"),
            sqlite_where=text("valid_to IS NULL"),
        ),
        Index(
            "ix_note_blocks_current_identity",
            "note_id",
            "block_id",
            unique=True,
            postgresql_where=text("valid_to IS NULL"),
            sqlite_where=text("valid_to IS NULL"),
        ),
        Index(
            "ix_note_blocks_siblings",
            "note_id",
            "parent_id",
            "position",
            "valid_to",
            "valid_from",
        ),
        Index(
            "ix_note_blocks_identity", "note_id", "block_id", "valid_to", "valid_from"
        ),
        Index("ix_note_blocks_type", "note_id", "block_type", "valid_to"),
    )
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    block_id: Mapped[str] = mapped_column(String(512))
    parent_id: Mapped[str | None] = mapped_column(String(512))
    position: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    block_type: Mapped[str] = mapped_column(
        String(64), default="paragraph", server_default="paragraph"
    )
    has_children_field: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    payload: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}"
    )
    payload_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    plain_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    valid_from: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    valid_to: Mapped[int | None] = mapped_column(Integer)
