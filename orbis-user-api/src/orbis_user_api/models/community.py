from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class CommunityTenant(Base):
    __tablename__ = "community_tenants"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    name: Mapped[str] = mapped_column(
        String(160),
        default="Orbis Community",
        server_default="Orbis Community",
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(32), default="active", server_default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)


class CommunityState(Base):
    __tablename__ = "community_state"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    setup_completed_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
