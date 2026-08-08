from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, Boolean, String, false
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    workspace_type: Mapped[str] = mapped_column(
        String(32), default="private", server_default="private", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), index=True)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    role: Mapped[str] = mapped_column(
        String(32), default="normal", server_default="normal", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), default="active", server_default="active", nullable=False
    )
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="pending", server_default="pending", nullable=False
    )
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ttl_seconds: Mapped[int] = mapped_column(
        BigInteger, default=86400, server_default="86400", nullable=False
    )
    invited_by_user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    accepted_by_user_id: Mapped[UUID | None] = mapped_column(GUID())
    email_sent: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    email_error_summary: Mapped[str | None] = mapped_column(String(240))
    accepted_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )


class OwnershipTransfer(Base):
    __tablename__ = "ownership_transfers"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    from_user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    target_member_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    target_user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="pending", server_default="pending", nullable=False
    )
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    email_sent: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    email_error_summary: Mapped[str | None] = mapped_column(String(240))
    confirmed_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    cancelled_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    created_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
    updated_at_ms: Mapped[int] = mapped_column(
        BigInteger, default=now_ms, server_default="0", nullable=False
    )
