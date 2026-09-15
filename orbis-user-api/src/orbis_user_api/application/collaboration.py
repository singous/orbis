from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from orbis_user_api.application.note_revisions import UNKNOWN_AUTHOR_NAME
from orbis_user_api.application.notes import _get_active_note, update_note_content
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.collaboration import NoteComment, NoteRevision
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import WorkspaceMember
from orbis_user_api.schemas.collaboration import (
    CommentCreateRequest,
    CommentOut,
    CommentUpdateRequest,
    RevisionRestoreRequest,
)
from orbis_user_api.schemas.note import NoteContentUpdateRequest
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import (
    NoteNotFound,
    ServiceError,
    WorkspaceMemberForbidden,
)

logger = logging.getLogger(__name__)


class CommentNotFound(ServiceError):
    pass


class RevisionNotFound(ServiceError):
    pass


async def _authorize_note(
    note_id: UUID,
    user: User,
    session: AsyncSession,
) -> tuple[Note, WorkspaceMember]:
    workspace, membership = await AuthorizationService.actor(user, session)
    AuthorizationService.require_capability(membership, Capability.RESOURCE_READ)
    note = await _get_active_note(note_id, workspace.id, session)
    seen = {note.id}
    ancestor_id = note.parent_id
    while ancestor_id is not None:
        if ancestor_id in seen:
            raise NoteNotFound
        seen.add(ancestor_id)
        ancestor = await session.get(Note, ancestor_id)
        if (
            ancestor is None
            or ancestor.workspace_id != workspace.id
            or ancestor.notebook_id != note.notebook_id
            or ancestor.status != "active"
        ):
            raise NoteNotFound
        ancestor_id = ancestor.parent_id
    return note, membership


async def _get_comment(
    comment_id: UUID, note: Note, session: AsyncSession
) -> NoteComment:
    comment = await session.get(NoteComment, comment_id)
    if (
        comment is None
        or comment.note_id != note.id
        or comment.workspace_id != note.workspace_id
    ):
        raise CommentNotFound
    return comment


def _comment_payload(comment: NoteComment, author_name: str | None) -> CommentOut:
    return CommentOut(
        id=comment.id,
        note_id=comment.note_id,
        parent_id=comment.parent_id,
        author_id=comment.author_id,
        author_name=author_name or UNKNOWN_AUTHOR_NAME,
        body=comment.body,
        is_resolved=comment.is_resolved,
        created_at_ms=comment.created_at_ms,
        updated_at_ms=comment.updated_at_ms,
    )


async def list_comments(
    note_id: UUID,
    user: User,
    session: AsyncSession,
    *,
    offset: int,
    limit: int,
) -> tuple[list[CommentOut], int]:
    note, _ = await _authorize_note(note_id, user, session)
    filters = (
        NoteComment.note_id == note.id,
        NoteComment.workspace_id == note.workspace_id,
    )
    total = await session.scalar(
        select(func.count()).select_from(NoteComment).where(*filters)
    )
    result = await session.execute(
        select(NoteComment, User.display_name)
        .outerjoin(User, User.id == NoteComment.author_id)
        .where(*filters)
        .order_by(NoteComment.created_at_ms.asc(), NoteComment.id.asc())
        .offset(offset)
        .limit(limit)
    )
    return [_comment_payload(comment, name) for comment, name in result.all()], int(
        total or 0
    )


async def create_comment(
    note_id: UUID,
    payload: CommentCreateRequest,
    user: User,
    session: AsyncSession,
) -> CommentOut:
    note, _ = await _authorize_note(note_id, user, session)
    if payload.parent_id is not None:
        await _get_comment(payload.parent_id, note, session)
    comment = NoteComment(
        workspace_id=note.workspace_id,
        note_id=note.id,
        author_id=user.id,
        parent_id=payload.parent_id,
        body=payload.body,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    logger.info(
        "Note comment created",
        extra={"note_id": str(note.id), "comment_id": str(comment.id)},
    )
    return _comment_payload(comment, user.display_name)


async def update_comment(
    note_id: UUID,
    comment_id: UUID,
    payload: CommentUpdateRequest,
    user: User,
    session: AsyncSession,
) -> CommentOut:
    note, membership = await _authorize_note(note_id, user, session)
    comment = await _get_comment(comment_id, note, session)
    is_author = comment.author_id == user.id
    if payload.body is not None and not is_author:
        raise WorkspaceMemberForbidden
    if payload.is_resolved is not None and not is_author:
        AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    if payload.body is not None:
        comment.body = payload.body
    if payload.is_resolved is not None:
        comment.is_resolved = payload.is_resolved
    comment.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(comment)
    author_name = await session.scalar(
        select(User.display_name).where(User.id == comment.author_id)
    )
    logger.info(
        "Note comment updated",
        extra={"note_id": str(note.id), "comment_id": str(comment.id)},
    )
    return _comment_payload(comment, author_name)


async def list_revisions(
    note_id: UUID,
    user: User,
    session: AsyncSession,
    *,
    offset: int,
    limit: int,
) -> tuple[list[NoteRevision], int]:
    note, _ = await _authorize_note(note_id, user, session)
    filters = (
        NoteRevision.note_id == note.id,
        NoteRevision.workspace_id == note.workspace_id,
    )
    total = await session.scalar(
        select(func.count()).select_from(NoteRevision).where(*filters)
    )
    result = await session.execute(
        select(NoteRevision)
        .options(
            load_only(
                NoteRevision.id,
                NoteRevision.content_version,
                NoteRevision.author_name,
                NoteRevision.created_at_ms,
            )
        )
        .where(*filters)
        .order_by(NoteRevision.content_version.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars()), int(total or 0)


async def get_revision(
    note_id: UUID,
    revision_id: UUID,
    user: User,
    session: AsyncSession,
) -> NoteRevision:
    note, _ = await _authorize_note(note_id, user, session)
    revision = await session.get(NoteRevision, revision_id)
    if (
        revision is None
        or revision.note_id != note.id
        or revision.workspace_id != note.workspace_id
    ):
        raise RevisionNotFound
    return revision


async def restore_revision(
    note_id: UUID,
    revision_id: UUID,
    payload: RevisionRestoreRequest,
    user: User,
    session: AsyncSession,
) -> NoteContent:
    _, membership = await _authorize_note(note_id, user, session)
    AuthorizationService.require_capability(membership, Capability.RESOURCE_MANAGE)
    revision = await get_revision(note_id, revision_id, user, session)
    content = await update_note_content(
        note_id,
        NoteContentUpdateRequest(
            expected_version=payload.expected_version,
            blocks=revision.blocks,
        ),
        user,
        session,
    )
    logger.info(
        "Note revision restored",
        extra={
            "note_id": str(note_id),
            "revision_id": str(revision_id),
            "content_version": content.content_version,
        },
    )
    return content
