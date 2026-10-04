from __future__ import annotations

from uuid import UUID

from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.block_content import (
    BlockContentStore,
    read_stored_content,
)
from orbis_user_api.application.integration_auth import error
from orbis_user_api.domain.document_references import (
    FILE_REFERENCE_PREFIX,
    iter_document_references,
    managed_file_ids,
    parse_document_file_reference,
)
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.integration import IntegrationAttachment
from orbis_user_api.models.note_block import NoteBlockDocument
from orbis_user_api.models.note_block import NoteBlockVersion as Block


async def note_references_file(note, file_id: UUID, session: AsyncSession) -> bool:
    header = await BlockContentStore(session, note).header()
    if header is None:
        return file_id in managed_file_ids(
            (await read_stored_content(note, session)).blocks
        )
    reference = f"orbis-file:{file_id}"
    payloads = await session.scalars(
        select(Block.payload).where(
            Block.note_id == note.id,
            Block.valid_to.is_(None),
            cast(Block.payload, String).contains(reference),
        )
    )
    return any(file_id in managed_file_ids(payload) for payload in payloads)


async def authorized_file(principal, note_id, file_id, session):
    principal.require("files:read")
    note = await principal.note(note_id, session)
    binding = await session.scalar(
        select(IntegrationAttachment.id).where(
            IntegrationAttachment.file_id == file_id,
            IntegrationAttachment.note_id == note_id,
            IntegrationAttachment.workspace_id == principal.workspace.id,
        )
    )
    if binding is None and not await note_references_file(note, file_id, session):
        raise error(404, "FILE_NOT_FOUND", "文件不存在或未关联到授权文档")
    asset = await session.get(FileAsset, file_id)
    if (
        asset is None
        or asset.workspace_id != principal.workspace.id
        or asset.upload_status != "completed"
    ):
        raise error(404, "FILE_NOT_FOUND", "文件不存在或上传未完成")
    return asset


async def validate_document_references(principal, note_id, upserts, session):
    """Inspect only changed shallow payloads, using the renderer's contract."""
    targets: set[UUID] = set()
    for reference, _media in iter_document_references(upserts):
        if not reference.startswith(FILE_REFERENCE_PREFIX):
            continue
        identifier = parse_document_file_reference(reference)
        if identifier is None:
            raise error(422, "FILE_REFERENCE_INVALID", "附件引用格式无效")
        targets.add(identifier)
    if not targets:
        return
    note = await principal.note(note_id, session)
    for file_id in targets:
        if await note_references_file(note, file_id, session):
            continue
        await authorized_file(principal, note_id, file_id, session)


async def validate_new_note_references(principal, blocks, session) -> set[UUID]:
    """A constructor cannot turn an ungranted managed ID into a public link."""
    references = list(iter_document_references(blocks))
    targets: set[UUID] = set()
    for reference, _media in references:
        if reference.startswith(FILE_REFERENCE_PREFIX):
            identifier = parse_document_file_reference(reference)
            if identifier is None:
                raise error(422, "FILE_REFERENCE_INVALID", "附件引用格式无效")
            targets.add(identifier)
    if not targets:
        return targets
    principal.require("files:read")
    from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup

    allowed = (
        select(Note.id)
        .join(Notebook, Notebook.id == Note.notebook_id)
        .join(NoteGroup, NoteGroup.id == Notebook.group_id)
        .where(
            *principal.filters(),
            Notebook.status == "active",
            NoteGroup.status == "active",
        )
    )
    for file_id in targets:
        asset = await session.get(FileAsset, file_id)
        if (
            asset is None
            or asset.workspace_id != principal.workspace.id
            or asset.upload_status != "completed"
        ):
            raise error(404, "FILE_NOT_FOUND", "文件不存在或不在授权范围内")
        bound = await session.scalar(
            select(IntegrationAttachment.id)
            .where(
                IntegrationAttachment.file_id == file_id,
                IntegrationAttachment.note_id.in_(allowed),
            )
            .limit(1)
        )
        if bound is not None:
            continue
        reference = f"orbis-file:{file_id}"
        payloads = await session.scalars(
            select(Block.payload).where(
                Block.note_id.in_(allowed),
                Block.valid_to.is_(None),
                cast(Block.payload, String).contains(reference),
            )
        )
        referenced = any(file_id in managed_file_ids(payload) for payload in payloads)
        if not referenced:
            legacy = await session.scalars(
                select(NoteContent.blocks).where(
                    NoteContent.note_id.in_(allowed),
                    cast(NoteContent.blocks, String).contains(reference),
                    ~select(NoteBlockDocument.id)
                    .where(NoteBlockDocument.note_id == NoteContent.note_id)
                    .exists(),
                )
            )
            referenced = any(file_id in managed_file_ids(payload) for payload in legacy)
        if not referenced:
            raise error(404, "FILE_NOT_FOUND", "文件未关联到令牌授权范围内的文档")
    return targets
