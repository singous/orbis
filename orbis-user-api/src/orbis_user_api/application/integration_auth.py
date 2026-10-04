from __future__ import annotations

import hashlib
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.notes import _get_active_note, _get_active_notebook
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.integration import IntegrationToken
from orbis_user_api.models.note import Note
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.schemas.integration import TokenCreate
from orbis_user_api.services.capabilities import ROLE_CAPABILITIES, Capability
from orbis_user_api.services.exceptions import NotebookNotFound, NoteNotFound
from orbis_user_api.services.workspace import get_current_workspace

bearer = HTTPBearer(auto_error=False)
TOKEN_PREFIX = "orbis_it_"
DAY_MS = 86_400_000


def error(status: int, code: str, message: str, data=None) -> ApiError:
    return ApiError(status_code=status, code=code, message=message, data=data)


def token_public(token: IntegrationToken) -> dict:
    return {
        field: getattr(token, field)
        for field in (
            "id",
            "name",
            "workspace_id",
            "permissions",
            "notebook_id",
            "note_id",
            "secret_prefix",
            "created_at_ms",
            "expires_at_ms",
            "revoked_at_ms",
            "last_used_at_ms",
        )
    }


@dataclass(frozen=True)
class IntegrationPrincipal:
    token: IntegrationToken
    user: User
    workspace: Workspace
    membership: WorkspaceMember

    def effective_permissions(self) -> list[str]:
        capabilities = ROLE_CAPABILITIES.get(self.membership.role, frozenset())
        return [
            permission
            for permission in self.token.permissions
            if (
                Capability.RESOURCE_MANAGE
                if permission in {"notes:write", "files:write", "shares:manage"}
                else Capability.RESOURCE_READ
            )
            in capabilities
        ]

    def require(self, permission: str) -> None:
        capabilities = ROLE_CAPABILITIES.get(self.membership.role, frozenset())
        needed = (
            Capability.RESOURCE_MANAGE
            if permission in {"notes:write", "files:write", "shares:manage"}
            else Capability.RESOURCE_READ
        )
        if permission not in self.token.permissions or needed not in capabilities:
            raise error(
                403, "INTEGRATION_PERMISSION_DENIED", "集成令牌没有执行此操作的权限"
            )

    async def note(self, note_id: UUID, session: AsyncSession, *, write=False) -> Note:
        self.require("notes:write" if write else "notes:read")
        try:
            note = await _get_active_note(note_id, self.workspace.id, session)
        except (NoteNotFound, NotebookNotFound):
            raise error(404, "NOTE_NOT_FOUND", "文档不存在或不在授权范围内") from None
        if (self.token.note_id and self.token.note_id != note.id) or (
            self.token.notebook_id and self.token.notebook_id != note.notebook_id
        ):
            raise error(404, "NOTE_NOT_FOUND", "文档不存在或不在授权范围内")
        return note

    def filters(self):
        filters = [Note.workspace_id == self.workspace.id, Note.status == "active"]
        if self.token.notebook_id:
            filters.append(Note.notebook_id == self.token.notebook_id)
        if self.token.note_id:
            filters.append(Note.id == self.token.note_id)
        return filters


async def integration_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> AsyncIterator[IntegrationPrincipal]:
    if credentials is None or not credentials.credentials.startswith(TOKEN_PREFIX):
        raise error(401, "INTEGRATION_AUTH_REQUIRED", "需要有效的集成令牌")
    digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    token = await session.scalar(
        select(IntegrationToken).where(IntegrationToken.secret_hash == digest)
    )
    timestamp = now_ms()
    if (
        token is None
        or token.revoked_at_ms is not None
        or (token.expires_at_ms is not None and token.expires_at_ms <= timestamp)
    ):
        raise error(401, "INTEGRATION_TOKEN_INVALID", "集成令牌无效、已撤销或已过期")
    try:
        workspace_id = UUID(request.headers.get("X-Workspace-ID", ""))
    except ValueError:
        raise error(
            422, "WORKSPACE_CONTEXT_REQUIRED", "必须显式提供有效的 X-Workspace-ID"
        ) from None
    if token.workspace_id != workspace_id:
        raise error(
            403, "INTEGRATION_WORKSPACE_FORBIDDEN", "工作空间不在集成令牌授权范围内"
        )
    user = await session.get(User, token.owner_id)
    workspace = await session.get(Workspace, workspace_id)
    membership = await session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == token.owner_id,
            WorkspaceMember.status == "active",
        )
    )
    if (
        user is None
        or user.status != "active"
        or workspace is None
        or workspace.status != "active"
        or membership is None
        or Capability.RESOURCE_READ
        not in ROLE_CAPABILITIES.get(membership.role, frozenset())
    ):
        raise error(
            401, "INTEGRATION_ACCESS_REVOKED", "当前账号或工作空间成员身份已失效"
        )
    # Auth touches never commit here: content and receipts retain one transaction.
    # Throttle this metadata write to avoid extra contention on frequent reads.
    if token.last_used_at_ms is None or timestamp - token.last_used_at_ms >= 60_000:
        token.last_used_at_ms = timestamp
    try:
        yield IntegrationPrincipal(token, user, workspace, membership)
    except BaseException:
        await session.rollback()
        raise
    else:
        await session.commit()


async def create_token(payload: TokenCreate, user: User, session: AsyncSession) -> dict:
    workspace, membership = await get_current_workspace(user, session)
    capabilities = ROLE_CAPABILITIES.get(membership.role, frozenset())
    if Capability.RESOURCE_READ not in capabilities or (
        set(payload.permissions) & {"notes:write", "files:write", "shares:manage"}
        and Capability.RESOURCE_MANAGE not in capabilities
    ):
        raise error(
            403, "INTEGRATION_PERMISSION_DENIED", "不能授权超出当前成员角色的权限"
        )
    try:
        if payload.notebook_id:
            await _get_active_notebook(payload.notebook_id, workspace.id, session)
        if payload.note_id:
            note = await _get_active_note(payload.note_id, workspace.id, session)
            if payload.notebook_id and note.notebook_id != payload.notebook_id:
                raise NoteNotFound
    except (NoteNotFound, NotebookNotFound):
        raise error(404, "INTEGRATION_SCOPE_NOT_FOUND", "授权目标不存在") from None
    secret = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token = IntegrationToken(
        owner_id=user.id,
        workspace_id=workspace.id,
        name=payload.name,
        secret_hash=hashlib.sha256(secret.encode()).hexdigest(),
        secret_prefix=secret[:16],
        permissions=sorted(set(payload.permissions) | {"notes:read"}),
        notebook_id=payload.notebook_id,
        note_id=payload.note_id,
        expires_at_ms=now_ms() + payload.expires_in_days * DAY_MS,
    )
    session.add(token)
    await session.commit()
    return {**token_public(token), "token": secret}
