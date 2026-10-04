from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.document_share import DocumentShare
from orbis_user_api.models.note import Note, Notebook, NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace
from orbis_user_api.schemas.document_share import (
    PublicShareOut,
    ShareCreateRequest,
    SharedNoteOut,
)
from orbis_user_api.services.authorization import AuthorizationService, Capability

logger = logging.getLogger(__name__)
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
MIN_SHARE_SECRET_LENGTH = 32
KNOWN_DEFAULT_SHARE_SECRET = "change-me-action-secret"


class ShareUnavailable(Exception):
    pass


class ScopeAcknowledgementRequired(Exception):
    pass


class ShareSigningUnavailable(Exception):
    pass


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _derived_token(share: DocumentShare, secret: str) -> str:
    message = f"orbis:live-document-share:v1:{share.id}:{share.workspace_id}:{share.notebook_id}:{share.root_note_id or '*'}"
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def recover_share_path(share: DocumentShare, secret: str) -> str | None:
    """Recover only when the current key matches this link's stored digest.

    Key rotation or legacy random links keep their existing bearer access, but
    cannot silently emit a different, invalid link to their manager.
    """
    if share.revoked_at_ms is not None:
        return None
    token = _derived_token(share, secret)
    return (
        f"/share/{token}"
        if hmac.compare_digest(token_digest(token), share.token_digest)
        else None
    )


@dataclass(frozen=True)
class ShareScope:
    share: DocumentShare
    notebook: Notebook
    root: Note | None

    def note_tree(self):
        """Only paths entirely composed of active notes enter the subtree."""
        active = (
            Note.workspace_id == self.share.workspace_id,
            Note.notebook_id == self.share.notebook_id,
            Note.status == "active",
        )
        root_filter = Note.id == self.root.id if self.root else Note.parent_id.is_(None)
        tree = (
            select(Note.id)
            .where(*active, root_filter)
            .cte("shared_note_tree", recursive=True)
        )
        return tree.union_all(
            select(Note.id).join(tree, Note.parent_id == tree.c.id).where(*active)
        )

    async def note(self, note_id: UUID, session: AsyncSession) -> Note:
        note = await session.get(Note, note_id)
        ancestor, seen = note, set()
        while ancestor is not None:
            if (
                ancestor.id in seen
                or ancestor.workspace_id != self.share.workspace_id
                or ancestor.notebook_id != self.notebook.id
                or ancestor.status != "active"
            ):
                raise ShareUnavailable
            seen.add(ancestor.id)
            if self.root and ancestor.id == self.root.id:
                return note
            if ancestor.parent_id is None:
                if self.root is None:
                    return note
                break
            ancestor = await session.get(Note, ancestor.parent_id)
        raise ShareUnavailable

    async def manifest(self, session: AsyncSession) -> PublicShareOut:
        tree = self.note_tree()
        rows = (
            await session.execute(
                select(
                    Note.id,
                    Note.parent_id,
                    Note.title,
                    Note.sort_order,
                    Note.updated_at_ms,
                )
                .where(Note.id.in_(select(tree.c.id)))
                .order_by(Note.sort_order, Note.created_at_ms, Note.id)
            )
        ).all()
        return PublicShareOut(
            title=self.root.title if self.root else self.notebook.title,
            root_note_id=self.root.id if self.root else None,
            items=[
                SharedNoteOut(
                    id=row.id,
                    parent_id=None
                    if self.root and row.id == self.root.id
                    else row.parent_id,
                    title=row.title,
                    sort_order=row.sort_order,
                    updated_at_ms=row.updated_at_ms,
                )
                for row in rows
            ],
        )


async def _active_scope(share: DocumentShare, session: AsyncSession) -> ShareScope:
    notebook = await session.get(Notebook, share.notebook_id)
    if (
        notebook is None
        or notebook.workspace_id != share.workspace_id
        or notebook.status != "active"
    ):
        raise ShareUnavailable
    group = await session.get(NoteGroup, notebook.group_id)
    workspace = await session.get(Workspace, share.workspace_id)
    if (
        group is None
        or group.workspace_id != share.workspace_id
        or group.status != "active"
        or workspace is None
        or workspace.status != "active"
    ):
        raise ShareUnavailable
    root = None
    if share.root_note_id is not None:
        root = await session.get(Note, share.root_note_id)
        ancestor, seen = root, set()
        while ancestor is not None:
            if (
                ancestor.id in seen
                or ancestor.workspace_id != share.workspace_id
                or ancestor.notebook_id != notebook.id
                or ancestor.status != "active"
            ):
                raise ShareUnavailable
            seen.add(ancestor.id)
            if ancestor.parent_id is None:
                break
            ancestor = await session.get(Note, ancestor.parent_id)
            if ancestor is None:
                raise ShareUnavailable
        if root is None:
            raise ShareUnavailable
    return ShareScope(share, notebook, root)


async def resolve_share(token: str, session: AsyncSession) -> ShareScope:
    if not TOKEN_PATTERN.fullmatch(token):
        raise ShareUnavailable
    share = await session.scalar(
        select(DocumentShare).where(
            DocumentShare.token_digest == token_digest(token),
            DocumentShare.revoked_at_ms.is_(None),
        )
    )
    if share is None:
        raise ShareUnavailable
    return await _active_scope(share, session)


async def _manager(user: User, session: AsyncSession):
    workspace, membership = await AuthorizationService.actor(user, session)
    AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    return workspace


async def create_share(
    payload: ShareCreateRequest,
    user: User,
    session: AsyncSession,
    secret: str | None = None,
) -> tuple[DocumentShare, str]:
    workspace = await _manager(user, session)
    if not payload.acknowledge_public_scope:
        raise ScopeAcknowledgementRequired
    if (
        not secret
        or len(secret) < MIN_SHARE_SECRET_LENGTH
        or secret == KNOWN_DEFAULT_SHARE_SECRET
    ):
        raise ShareSigningUnavailable
    share = DocumentShare(
        id=new_uuidv7(),
        workspace_id=workspace.id,
        notebook_id=payload.notebook_id,
        root_note_id=payload.root_note_id,
        created_by=user.id,
    )
    token = _derived_token(share, secret)
    share.token_digest = token_digest(token)
    await _active_scope(share, session)
    session.add(share)
    await session.commit()
    await session.refresh(share)
    logger.info(
        "Live document share created",
        extra={"share_id": str(share.id), "workspace_id": str(workspace.id)},
    )
    return share, token


async def list_shares(
    notebook_id: UUID, root_note_id: UUID | None, user: User, session: AsyncSession
) -> list[DocumentShare]:
    workspace = await _manager(user, session)
    return list(
        await session.scalars(
            select(DocumentShare)
            .where(
                DocumentShare.workspace_id == workspace.id,
                DocumentShare.notebook_id == notebook_id,
                DocumentShare.root_note_id == root_note_id,
            )
            .order_by(DocumentShare.created_at_ms.desc())
        )
    )


async def revoke_share(
    share_id: UUID, user: User, session: AsyncSession
) -> DocumentShare:
    workspace = await _manager(user, session)
    share = await session.scalar(
        select(DocumentShare).where(
            DocumentShare.id == share_id, DocumentShare.workspace_id == workspace.id
        )
    )
    if share is None:
        raise ShareUnavailable
    if share.revoked_at_ms is None:
        share.revoked_at_ms = now_ms()
        await session.commit()
        await session.refresh(share)
        logger.info(
            "Live document share revoked",
            extra={"share_id": str(share.id), "workspace_id": str(workspace.id)},
        )
    return share
