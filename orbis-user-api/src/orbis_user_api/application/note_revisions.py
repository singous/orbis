from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.user import User

UNKNOWN_AUTHOR_NAME = "未命名成员"
LEGACY_AUTHOR_NAME = "历史版本"


async def record_content_revisions(
    note: Note,
    previous: NoteContent,
    *,
    blocks: dict[str, Any],
    plain_text: str,
    author: User,
    timestamp: int,
    session: AsyncSession,
) -> None:
    """Record snapshots only after the caller acquires the version-guarded write."""
    existing = await session.scalar(
        select(NoteRevision.id).where(
            NoteRevision.note_id == note.id,
            NoteRevision.content_version == previous.content_version,
        )
    )
    if existing is None:
        # Imported and pre-history content must survive the first tracked edit.
        original_author = (
            await session.get(User, note.owner_id)
            if previous.content_version == 1
            else None
        )
        session.add(
            NoteRevision(
                workspace_id=note.workspace_id,
                note_id=note.id,
                author_id=original_author.id if original_author else None,
                author_name=(original_author.display_name or UNKNOWN_AUTHOR_NAME)
                if original_author
                else LEGACY_AUTHOR_NAME,
                content_version=previous.content_version,
                blocks=deepcopy(previous.blocks),
                plain_text=previous.plain_text,
                created_at_ms=previous.updated_at_ms,
            )
        )
    session.add(
        NoteRevision(
            workspace_id=note.workspace_id,
            note_id=note.id,
            author_id=author.id,
            author_name=author.display_name or UNKNOWN_AUTHOR_NAME,
            content_version=previous.content_version + 1,
            blocks=deepcopy(blocks),
            plain_text=plain_text,
            created_at_ms=timestamp,
        )
    )
