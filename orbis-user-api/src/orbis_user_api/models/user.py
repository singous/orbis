from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, Boolean, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    current_workspace_id: Mapped[UUID | None] = mapped_column(GUID())
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", server_default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_codes"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    consumed_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
