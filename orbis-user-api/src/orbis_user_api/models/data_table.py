"""Document-owned tables with immutable metadata and temporal record versions."""

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type

EMPTY_UUID = UUID(int=0)


class DataTable(Base):
    __tablename__ = "data_tables"
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(
        GUID(),
        index=True,
        default=EMPTY_UUID,
        server_default=str(EMPTY_UUID),
        nullable=False,
    )
    workspace_id: Mapped[UUID] = mapped_column(
        GUID(),
        index=True,
        default=EMPTY_UUID,
        server_default=str(EMPTY_UUID),
        nullable=False,
    )
    block_id: Mapped[str] = mapped_column(
        String(120), default="", server_default="", nullable=False
    )
    head_revision: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class DataTableRevision(Base):
    __tablename__ = "data_table_revisions"
    __table_args__ = (
        UniqueConstraint("table_id", "revision", name="uq_data_table_revision"),
    )
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    table_id: Mapped[UUID] = mapped_column(
        GUID(), default=EMPTY_UUID, server_default=str(EMPTY_UUID), nullable=False
    )
    revision: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    definition: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class DataTableRecord(Base):
    __tablename__ = "data_table_records"
    __table_args__ = (
        UniqueConstraint(
            "table_id", "record_id", "valid_from", name="uq_data_table_record_version"
        ),
        Index(
            "ix_data_table_record_version",
            "table_id",
            "valid_from",
            "valid_to",
            "record_id",
        ),
        Index(
            "ix_data_table_record_current",
            "table_id",
            "record_id",
            postgresql_where=text("valid_to IS NULL"),
            sqlite_where=text("valid_to IS NULL"),
        ),
    )
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    table_id: Mapped[UUID] = mapped_column(
        GUID(), default=EMPTY_UUID, server_default=str(EMPTY_UUID), nullable=False
    )
    record_id: Mapped[UUID] = mapped_column(
        GUID(), default=new_uuidv7, server_default=str(EMPTY_UUID), nullable=False
    )
    valid_from: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    valid_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    values: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class DataTableReceipt(Base):
    __tablename__ = "data_table_receipts"
    __table_args__ = (
        UniqueConstraint("note_id", "operation_id", name="uq_data_table_operation"),
    )
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    note_id: Mapped[UUID] = mapped_column(
        GUID(), default=EMPTY_UUID, server_default=str(EMPTY_UUID), nullable=False
    )
    operation_id: Mapped[UUID] = mapped_column(
        GUID(), default=new_uuidv7, server_default=str(EMPTY_UUID), nullable=False
    )
    fingerprint: Mapped[str] = mapped_column(
        String(64), default="", server_default="", nullable=False
    )
    result: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class PublishedTable(Base):
    __tablename__ = "published_tables"
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    site_id: Mapped[UUID] = mapped_column(
        GUID(),
        index=True,
        default=EMPTY_UUID,
        server_default=str(EMPTY_UUID),
        nullable=False,
    )
    body_id: Mapped[UUID] = mapped_column(
        GUID(),
        index=True,
        default=EMPTY_UUID,
        server_default=str(EMPTY_UUID),
        nullable=False,
    )
    definition: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}", nullable=False
    )
    total: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )


class PublishedTableRecord(Base):
    __tablename__ = "published_table_records"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "position", name="uq_published_table_position"),
    )
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    snapshot_id: Mapped[UUID] = mapped_column(
        GUID(), default=EMPTY_UUID, server_default=str(EMPTY_UUID), nullable=False
    )
    position: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    cells: Mapped[list[str]] = mapped_column(
        json_type, default=list, server_default="[]", nullable=False
    )
