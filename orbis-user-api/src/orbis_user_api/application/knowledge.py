from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import UploadFile
from orbis_contracts.ingestion import IngestionRequestedV1
from orbis_contracts.topics import INGESTION_REQUESTED_TOPIC
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.notes import get_note, get_note_content
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.infrastructure.events import EventPublisher
from orbis_user_api.infrastructure.index_cleanup import IndexCleanupGateway
from orbis_user_api.models.knowledge import (
    KnowledgeBase,
    KnowledgeSource,
    ProcessingJob,
    SourceVersion,
)
from orbis_user_api.models.user import User
from orbis_user_api.schemas.knowledge import (
    KnowledgeBaseCreateRequest,
    KnowledgeBaseUpdateRequest,
)
from orbis_user_api.services.exceptions import (
    DuplicateKnowledgeSource,
    EventPublishFailed,
    KnowledgeBaseConfirmationInvalid,
    KnowledgeBaseNotFound,
    KnowledgeCleanupFailed,
    ProcessingJobNotFound,
    ProcessingJobRetryInvalid,
    SourceNotFound,
    SourceTypeUnsupported,
)
from orbis_user_api.services.storage import LocalFileStorage, safe_filename
from orbis_user_api.services.workspace import get_current_workspace

SUPPORTED_FILE_TYPES = {
    ".md": {"text/markdown", "text/plain", "application/octet-stream"},
    ".markdown": {"text/markdown", "text/plain", "application/octet-stream"},
    ".txt": {"text/plain", "application/octet-stream"},
    ".pdf": {"application/pdf", "application/octet-stream"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    },
}


def _safe_error(error: Exception) -> str:
    return (str(error).strip() or error.__class__.__name__)[:500]


async def _get_knowledge_base(
    knowledge_base_id: UUID,
    workspace_id: UUID,
    session: AsyncSession,
    *,
    allow_deletion_failed: bool = False,
) -> KnowledgeBase:
    knowledge_base = await session.get(KnowledgeBase, knowledge_base_id)
    allowed_statuses = (
        {"active", "deletion_failed"} if allow_deletion_failed else {"active"}
    )
    if (
        knowledge_base is None
        or knowledge_base.workspace_id != workspace_id
        or knowledge_base.status not in allowed_statuses
    ):
        raise KnowledgeBaseNotFound
    return knowledge_base


async def create_knowledge_base(
    payload: KnowledgeBaseCreateRequest,
    user: User,
    session: AsyncSession,
) -> KnowledgeBase:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = KnowledgeBase(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        name=payload.name.strip(),
        description=payload.description.strip(),
    )
    session.add(knowledge_base)
    await session.commit()
    await session.refresh(knowledge_base)
    return knowledge_base


async def list_knowledge_bases(
    user: User, session: AsyncSession
) -> list[KnowledgeBase]:
    workspace, _ = await get_current_workspace(user, session)
    result = await session.execute(
        select(KnowledgeBase)
        .where(
            KnowledgeBase.workspace_id == workspace.id,
            KnowledgeBase.status.in_({"active", "deletion_failed"}),
        )
        .order_by(
            KnowledgeBase.updated_at_ms.desc(), KnowledgeBase.created_at_ms.desc()
        )
    )
    return list(result.scalars())


async def get_knowledge_base(
    knowledge_base_id: UUID, user: User, session: AsyncSession
) -> KnowledgeBase:
    workspace, _ = await get_current_workspace(user, session)
    return await _get_knowledge_base(
        knowledge_base_id, workspace.id, session, allow_deletion_failed=True
    )


async def update_knowledge_base(
    knowledge_base_id: UUID,
    payload: KnowledgeBaseUpdateRequest,
    user: User,
    session: AsyncSession,
) -> KnowledgeBase:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(knowledge_base_id, workspace.id, session)
    if payload.name is not None:
        knowledge_base.name = payload.name.strip()
    if payload.description is not None:
        knowledge_base.description = payload.description.strip()
    knowledge_base.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(knowledge_base)
    return knowledge_base


async def delete_knowledge_base(
    knowledge_base_id: UUID,
    confirmation: str,
    index_cleanup: IndexCleanupGateway,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> None:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(
        knowledge_base_id, workspace.id, session, allow_deletion_failed=True
    )
    if confirmation != knowledge_base.name:
        raise KnowledgeBaseConfirmationInvalid

    versions_result = await session.execute(
        select(SourceVersion).where(
            SourceVersion.knowledge_base_id == knowledge_base.id
        )
    )
    versions = list(versions_result.scalars())
    try:
        await index_cleanup.remove_knowledge_base(
            tenant_id=knowledge_base.tenant_id,
            workspace_id=knowledge_base.workspace_id,
            knowledge_base_id=knowledge_base.id,
        )
        for version in versions:
            await storage.delete(version.storage_key)
    except Exception as error:
        knowledge_base.status = "deletion_failed"
        knowledge_base.deletion_error_summary = _safe_error(error)
        knowledge_base.updated_at_ms = now_ms()
        await session.commit()
        raise KnowledgeCleanupFailed from error

    await session.execute(
        delete(ProcessingJob).where(
            ProcessingJob.knowledge_base_id == knowledge_base.id
        )
    )
    await session.execute(
        delete(SourceVersion).where(
            SourceVersion.knowledge_base_id == knowledge_base.id
        )
    )
    await session.execute(
        delete(KnowledgeSource).where(
            KnowledgeSource.knowledge_base_id == knowledge_base.id
        )
    )
    await session.delete(knowledge_base)
    await session.commit()


def _intake_payload(
    source: KnowledgeSource, version: SourceVersion, job: ProcessingJob
) -> dict[str, Any]:
    return {
        "source_id": source.id,
        "source_version_id": version.id,
        "processing_job_id": job.id,
        "source_type": source.source_type,
        "source_hash": version.source_hash,
        "version_number": version.version_number,
        "processing_status": job.status,
    }


def _event_for(
    knowledge_base: KnowledgeBase,
    source: KnowledgeSource,
    version: SourceVersion,
    job: ProcessingJob,
) -> IngestionRequestedV1:
    return IngestionRequestedV1(
        event_id=new_uuidv7(),
        occurred_at_ms=now_ms(),
        tenant_id=knowledge_base.tenant_id,
        workspace_id=knowledge_base.workspace_id,
        knowledge_base_id=knowledge_base.id,
        source_type=source.source_type,
        source_id=source.id,
        source_version_id=version.id,
        source_hash=version.source_hash,
        processing_job_id=job.id,
        storage_key=version.storage_key,
        filename=version.filename,
        mime_type=version.mime_type,
    )


async def _mark_publish_failed(
    error: Exception,
    source: KnowledgeSource,
    version: SourceVersion,
    job: ProcessingJob,
    session: AsyncSession,
) -> None:
    summary = _safe_error(error)
    timestamp = now_ms()
    source.status = "failed"
    source.updated_at_ms = timestamp
    version.status = "failed"
    version.error_summary = summary
    version.updated_at_ms = timestamp
    job.status = "failed"
    job.error_summary = summary
    job.updated_at_ms = timestamp
    await session.commit()


async def _publish_intake(
    publisher: EventPublisher,
    knowledge_base: KnowledgeBase,
    source: KnowledgeSource,
    version: SourceVersion,
    job: ProcessingJob,
    session: AsyncSession,
) -> None:
    try:
        await publisher.publish(
            INGESTION_REQUESTED_TOPIC,
            _event_for(knowledge_base, source, version, job),
        )
    except Exception as error:
        await _mark_publish_failed(error, source, version, job, session)
        details = {
            "message": "Ingestion event publication failed",
            "source_id": str(source.id),
            "source_version_id": str(version.id),
            "processing_job_id": str(job.id),
            "source_hash": version.source_hash,
        }
        raise EventPublishFailed(details) from error


def _validate_upload(upload: UploadFile) -> tuple[str, str]:
    original_filename = upload.filename or "uploaded-file"
    suffix = Path(original_filename).suffix.lower()
    mime_type = upload.content_type or "application/octet-stream"
    if (
        suffix not in SUPPORTED_FILE_TYPES
        or mime_type not in SUPPORTED_FILE_TYPES[suffix]
    ):
        raise SourceTypeUnsupported
    return original_filename, mime_type


async def upload_file_source(
    knowledge_base_id: UUID,
    upload: UploadFile,
    publisher: EventPublisher,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> dict[str, Any]:
    filename, mime_type = _validate_upload(upload)
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(knowledge_base_id, workspace.id, session)
    source_id = new_uuidv7()
    version_id = new_uuidv7()
    job_id = new_uuidv7()
    storage_key = (
        f"{workspace.id}/knowledge/{knowledge_base.id}/sources/"
        f"{source_id}/{version_id}/{safe_filename(filename)}"
    )
    file_size, source_hash = await storage.save_upload(upload, storage_key)
    duplicate_result = await session.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.knowledge_base_id == knowledge_base.id,
            KnowledgeSource.source_type == "file",
            KnowledgeSource.source_hash == source_hash,
        )
    )
    duplicate = duplicate_result.scalars().first()
    if duplicate is not None:
        await storage.delete(storage_key)
        raise DuplicateKnowledgeSource(
            source_id=duplicate.id,
            filename=duplicate.filename,
            processing_status=duplicate.status,
        )

    timestamp = now_ms()
    source = KnowledgeSource(
        id=source_id,
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        knowledge_base_id=knowledge_base.id,
        owner_id=user.id,
        source_type="file",
        filename=filename,
        mime_type=mime_type,
        source_hash=source_hash,
        current_version_number=1,
        status="created",
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    version = SourceVersion(
        id=version_id,
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        knowledge_base_id=knowledge_base.id,
        source_id=source.id,
        processing_job_id=job_id,
        version_number=1,
        source_hash=source_hash,
        storage_key=storage_key,
        filename=filename,
        mime_type=mime_type,
        file_size=file_size,
        status="created",
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    job = ProcessingJob(
        id=job_id,
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        knowledge_base_id=knowledge_base.id,
        source_type="file",
        source_id=source.id,
        source_version_id=version.id,
        source_hash=source_hash,
        status="created",
        attempt_count=1,
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add_all([source, version, job])
    await session.commit()
    await _publish_intake(publisher, knowledge_base, source, version, job, session)
    return _intake_payload(source, version, job)


async def publish_note_source(
    knowledge_base_id: UUID,
    note_id: UUID,
    publisher: EventPublisher,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> dict[str, Any]:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(knowledge_base_id, workspace.id, session)
    note = await get_note(note_id, user, session)
    content = await get_note_content(note_id, user, session)
    snapshot = {
        "schema_version": 1,
        "note": {
            "id": str(note.id),
            "title": note.title,
            "blocks": content.blocks,
        },
    }
    snapshot_bytes = json.dumps(
        snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")

    existing_result = await session.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.knowledge_base_id == knowledge_base.id,
            KnowledgeSource.source_type == "note_snapshot",
            KnowledgeSource.source_note_id == note.id,
        )
    )
    source = existing_result.scalar_one_or_none()
    source_hash = hashlib.sha256(snapshot_bytes).hexdigest()
    if source is not None and source.source_hash == source_hash:
        raise DuplicateKnowledgeSource(
            source_id=source.id,
            filename=source.filename,
            processing_status=source.status,
        )

    source_id = source.id if source is not None else new_uuidv7()
    version_id = new_uuidv7()
    job_id = new_uuidv7()
    version_number = source.current_version_number + 1 if source is not None else 1
    filename = f"{safe_filename(note.title)}.note.json"
    storage_key = (
        f"{workspace.id}/knowledge/{knowledge_base.id}/sources/"
        f"{source_id}/{version_id}/{filename}"
    )
    file_size, stored_hash = await storage.save_bytes(snapshot_bytes, storage_key)
    timestamp = now_ms()
    if source is None:
        source = KnowledgeSource(
            id=source_id,
            tenant_id=workspace.tenant_id,
            workspace_id=workspace.id,
            knowledge_base_id=knowledge_base.id,
            owner_id=user.id,
            source_type="note_snapshot",
            source_note_id=note.id,
            filename=filename,
            mime_type="application/vnd.orbis.note+json",
            source_hash=stored_hash,
            current_version_number=version_number,
            status="created",
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
        session.add(source)
    else:
        source.filename = filename
        source.source_hash = stored_hash
        source.current_version_number = version_number
        source.status = "created"
        source.deletion_error_summary = None
        source.updated_at_ms = timestamp

    version = SourceVersion(
        id=version_id,
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        knowledge_base_id=knowledge_base.id,
        source_id=source.id,
        processing_job_id=job_id,
        version_number=version_number,
        source_hash=stored_hash,
        storage_key=storage_key,
        filename=filename,
        mime_type="application/vnd.orbis.note+json",
        file_size=file_size,
        status="created",
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    job = ProcessingJob(
        id=job_id,
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        knowledge_base_id=knowledge_base.id,
        source_type="note_snapshot",
        source_id=source.id,
        source_version_id=version.id,
        source_hash=stored_hash,
        status="created",
        attempt_count=1,
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add_all([version, job])
    await session.commit()
    await _publish_intake(publisher, knowledge_base, source, version, job, session)
    return _intake_payload(source, version, job)


async def list_sources(
    knowledge_base_id: UUID, user: User, session: AsyncSession
) -> list[dict[str, Any]]:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(
        knowledge_base_id, workspace.id, session, allow_deletion_failed=True
    )
    result = await session.execute(
        select(KnowledgeSource)
        .where(KnowledgeSource.knowledge_base_id == knowledge_base.id)
        .order_by(
            KnowledgeSource.updated_at_ms.desc(), KnowledgeSource.created_at_ms.desc()
        )
    )
    items = []
    for source in result.scalars():
        job_result = await session.execute(
            select(ProcessingJob)
            .where(ProcessingJob.source_id == source.id)
            .order_by(ProcessingJob.created_at_ms.desc())
        )
        job = job_result.scalars().first()
        if job is None:
            continue
        items.append(
            {
                "id": source.id,
                "knowledge_base_id": source.knowledge_base_id,
                "source_type": source.source_type,
                "source_note_id": source.source_note_id,
                "filename": source.filename,
                "mime_type": source.mime_type,
                "source_hash": source.source_hash,
                "current_version_number": source.current_version_number,
                "status": source.status,
                "deletion_error_summary": source.deletion_error_summary,
                "processing_job_id": job.id,
                "processing_status": job.status,
                "error_summary": job.error_summary,
                "created_at_ms": source.created_at_ms,
                "updated_at_ms": source.updated_at_ms,
            }
        )
    return items


async def delete_source(
    knowledge_base_id: UUID,
    source_id: UUID,
    index_cleanup: IndexCleanupGateway,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> None:
    workspace, _ = await get_current_workspace(user, session)
    knowledge_base = await _get_knowledge_base(
        knowledge_base_id, workspace.id, session, allow_deletion_failed=True
    )
    source = await session.get(KnowledgeSource, source_id)
    if source is None or source.knowledge_base_id != knowledge_base.id:
        raise SourceNotFound
    versions_result = await session.execute(
        select(SourceVersion).where(SourceVersion.source_id == source.id)
    )
    versions = list(versions_result.scalars())
    try:
        await index_cleanup.remove_source(
            tenant_id=source.tenant_id,
            workspace_id=source.workspace_id,
            knowledge_base_id=source.knowledge_base_id,
            source_id=source.id,
        )
        for version in versions:
            await storage.delete(version.storage_key)
    except Exception as error:
        source.status = "deletion_failed"
        source.deletion_error_summary = _safe_error(error)
        source.updated_at_ms = now_ms()
        await session.commit()
        raise KnowledgeCleanupFailed from error

    await session.execute(
        delete(ProcessingJob).where(ProcessingJob.source_id == source.id)
    )
    await session.execute(
        delete(SourceVersion).where(SourceVersion.source_id == source.id)
    )
    await session.delete(source)
    await session.commit()


async def get_processing_job(
    job_id: UUID, user: User, session: AsyncSession
) -> ProcessingJob:
    workspace, _ = await get_current_workspace(user, session)
    job = await session.get(ProcessingJob, job_id)
    if job is None or job.workspace_id != workspace.id:
        raise ProcessingJobNotFound
    return job


async def retry_processing_job(
    job_id: UUID,
    publisher: EventPublisher,
    user: User,
    session: AsyncSession,
) -> ProcessingJob:
    job = await get_processing_job(job_id, user, session)
    if job.status != "failed":
        raise ProcessingJobRetryInvalid
    source = await session.get(KnowledgeSource, job.source_id)
    version = await session.get(SourceVersion, job.source_version_id)
    knowledge_base = await session.get(KnowledgeBase, job.knowledge_base_id)
    if source is None or version is None or knowledge_base is None:
        raise ProcessingJobNotFound

    timestamp = now_ms()
    job.status = "created"
    job.attempt_count += 1
    job.error_summary = None
    job.updated_at_ms = timestamp
    source.status = "created"
    source.updated_at_ms = timestamp
    version.status = "created"
    version.error_summary = None
    version.updated_at_ms = timestamp
    await session.commit()
    await _publish_intake(publisher, knowledge_base, source, version, job, session)
    await session.refresh(job)
    return job
