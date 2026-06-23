from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class FileAsset(Base):
    __tablename__ = "files"
    __table_args__ = (
        Index("ix_files_owner_created", "owner_id", "created_at_ms"),
        Index("ix_files_workspace_created", "workspace_id", "created_at_ms"),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("workspaces.id"), index=True, nullable=False)
    owner_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), index=True, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    upload_status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
