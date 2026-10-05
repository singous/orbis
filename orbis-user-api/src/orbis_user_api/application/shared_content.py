from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_content import (
    BlockContentStore,
    at_version,
    read_stored_content,
)
from orbis_user_api.application.document_shares import ShareScope, ShareUnavailable
from orbis_user_api.application.block_pages import json_bytes
from orbis_user_api.application.site_assets import file_reference
from orbis_user_api.domain.document_references import managed_file_ids
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.note import NoteContent
from orbis_user_api.models.note_block import NoteBlockVersion
from orbis_user_api.services.exceptions import NoteVersionConflict
from orbis_user_api.services.file import secure_file_response
from orbis_user_api.services.storage import LocalFileStorage


def _reader_block(block: dict[str, Any]) -> dict[str, Any]:
    """Drawing source remains private in both live and published readers."""
    if block.get("type") == "drawing":
        return {
            **block,
            "props": {key: value for key, value in block.get("props", {}).items() if key in {"url", "caption", "previewWidth"}},
        }
    if block.get("children"):
        return {**block, "children": [_reader_block(child) for child in block["children"]]}
    return block


async def public_content(
    scope: ShareScope,
    note_id: UUID,
    session: AsyncSession,
    *,
    parent_id: str | None,
    offset: int,
    limit: int,
    expected_version: int | None,
) -> dict[str, Any]:
    note = await scope.note(note_id, session)
    store = BlockContentStore(session, note)
    header = await store.header()
    version = (
        header.content_version
        if header
        else await session.scalar(
            select(NoteContent.content_version).where(NoteContent.note_id == note.id)
        )
    )
    if version is None:
        raise ShareUnavailable
    if expected_version is not None and expected_version != version:
        raise NoteVersionConflict
    page = await store.children(parent_id, offset, limit, version)
    blocks = [_reader_block(block) for block in page["blocks"]["blocks"]]
    return {
        **page, "title": note.title,
        "blocks": {**page["blocks"], "blocks": blocks},
        "returned_bytes": sum(json_bytes(block) for block in blocks),
    }


async def public_block(
    scope: ShareScope,
    note_id: UUID,
    block_id: str,
    session: AsyncSession,
    expected_version: int | None,
) -> dict[str, Any]:
    note = await scope.note(note_id, session)
    store = BlockContentStore(session, note)
    header = await store.header()
    version = (
        header.content_version
        if header
        else await session.scalar(
            select(NoteContent.content_version).where(NoteContent.note_id == note.id)
        )
    )
    if version is None:
        raise ShareUnavailable
    if expected_version is not None and expected_version != version:
        raise NoteVersionConflict
    result = await store.block(block_id, version)
    return {**result, "block": _reader_block(result["block"])}


async def shared_asset(
    scope: ShareScope,
    note_id: UUID,
    file_id: UUID,
    session: AsyncSession,
    storage: LocalFileStorage,
):
    note = await scope.note(note_id, session)
    asset = await session.get(FileAsset, file_id)
    if (
        asset is None
        or asset.workspace_id != scope.share.workspace_id
        or asset.upload_status != "completed"
    ):
        raise ShareUnavailable
    reference = file_reference(file_id)
    store = BlockContentStore(session, note)
    header = await store.header()
    if header is not None:
        # SQL narrows candidate payloads, then the domain predicate verifies a
        # real URL reference, preventing arbitrary text from granting access.
        payloads = await session.scalars(
            select(NoteBlockVersion.payload).where(
                NoteBlockVersion.note_id == note.id,
                at_version(header.content_version),
                cast(NoteBlockVersion.payload, String).contains(reference),
            )
        )
        referenced = any(file_id in managed_file_ids(payload) for payload in payloads)
    else:
        referenced = file_id in managed_file_ids(
            (await read_stored_content(note, session)).blocks
        )
    if not referenced:
        raise ShareUnavailable
    try:
        path = storage.resolve(asset.storage_key)
    except ValueError:
        raise ShareUnavailable from None
    if not path.is_file():
        raise ShareUnavailable
    return secure_file_response(
        path, filename=asset.original_filename, media_type=asset.mime_type
    )
