from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID, json_type


class IntegrationToken(Base):
    __tablename__ = "integration_tokens"
    __table_args__ = (
        UniqueConstraint("secret_hash"),
        Index("ix_integration_tokens_owner_workspace", "owner_id", "workspace_id"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    name: Mapped[str] = mapped_column(String(120))
    secret_hash: Mapped[str] = mapped_column(String(64))
    secret_prefix: Mapped[str] = mapped_column(String(20))
    permissions: Mapped[list[str]] = mapped_column(
        json_type, default=list, server_default="[]"
    )
    notebook_id: Mapped[UUID | None] = mapped_column(GUID())
    note_id: Mapped[UUID | None] = mapped_column(GUID())
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )
    expires_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    last_used_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class IntegrationOperation(Base):
    """A durable exactly-once receipt, committed with the content mutation."""

    __tablename__ = "integration_operations"
    __table_args__ = (UniqueConstraint("token_id", "operation_id"),)

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    token_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    operation_id: Mapped[UUID] = mapped_column(GUID())
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}"
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )


class IntegrationAttachment(Base):
    """File grants stay bound to their authorized document."""

    __tablename__ = "integration_attachments"
    __table_args__ = (UniqueConstraint("file_id", "note_id"),)
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    file_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    note_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )


class IntegrationImport(Base):
    __tablename__ = "integration_imports"
    __table_args__ = (UniqueConstraint("token_id", "operation_id"),)
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    token_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    operation_id: Mapped[UUID] = mapped_column(GUID())
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    notebook_id: Mapped[UUID] = mapped_column(GUID())
    parent_id: Mapped[UUID | None] = mapped_column(GUID())
    title: Mapped[str] = mapped_column(String(240))
    request_hash: Mapped[str] = mapped_column(String(64))
    source_sha256: Mapped[str] = mapped_column(String(64))
    total_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    received_bytes: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0"
    )
    status: Mapped[str] = mapped_column(
        String(32), default="uploading", server_default="uploading"
    )
    result: Mapped[dict[str, Any]] = mapped_column(
        json_type, default=dict, server_default="{}"
    )
    failure_code: Mapped[str | None] = mapped_column(String(64))
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0"
    )


class IntegrationImportChunk(Base):
    __tablename__ = "integration_import_chunks"
    __table_args__ = (UniqueConstraint("import_id", "offset_bytes"),)
    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    import_id: Mapped[UUID] = mapped_column(GUID(), index=True)
    offset_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(1024))
