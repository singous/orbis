from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    __table_args__ = (
        Index("ix_knowledge_bases_workspace_updated", "workspace_id", "updated_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    deletion_error_summary: Mapped[str | None] = mapped_column(Text)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    __table_args__ = (
        Index("ix_knowledge_sources_kb_created", "knowledge_base_id", "created_at_ms"),
        Index("ix_knowledge_sources_kb_hash", "knowledge_base_id", "source_hash"),
        Index("ix_knowledge_sources_note", "knowledge_base_id", "source_note_id"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_note_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    current_version_number: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="created", server_default="created", nullable=False
    )
    deletion_error_summary: Mapped[str | None] = mapped_column(Text)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class SourceVersion(Base):
    __tablename__ = "source_versions"
    __table_args__ = (
        UniqueConstraint(
            "source_id", "version_number", name="uq_source_versions_source_version"
        ),
        Index("ix_source_versions_kb_created", "knowledge_base_id", "created_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    source_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    processing_job_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="created", server_default="created", nullable=False
    )
    error_summary: Mapped[str | None] = mapped_column(Text)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    __table_args__ = (
        Index("ix_processing_jobs_workspace_created", "workspace_id", "created_at_ms"),
        Index("ix_processing_jobs_source_created", "source_id", "created_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    knowledge_base_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    source_version_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="created", server_default="created", nullable=False
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    error_summary: Mapped[str | None] = mapped_column(Text)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
