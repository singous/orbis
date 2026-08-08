from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    owner_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    workspace_type: Mapped[str] = mapped_column(String(32), default="private", server_default="private", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", server_default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(GUID(), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="member", server_default="member", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", server_default="active", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, server_default="0", nullable=False)
