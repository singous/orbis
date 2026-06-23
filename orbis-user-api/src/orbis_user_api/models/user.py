from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    user_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
