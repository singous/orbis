from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class DocumentShare(Base):
    """Revocable access to a live notebook or note subtree; no published copy."""

    __tablename__ = "document_shares"
    __table_args__ = (
        Index(
            "ix_document_shares_scope", "workspace_id", "notebook_id", "root_note_id"
        ),
    )

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    notebook_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    root_note_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    created_by: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
