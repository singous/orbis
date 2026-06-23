from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.db.base import Base
from orbis_user_api.db.types import GUID


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    owner_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),)

    id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=new_uuidv7)
    workspace_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("workspaces.id"), index=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="owner", nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, nullable=False)
