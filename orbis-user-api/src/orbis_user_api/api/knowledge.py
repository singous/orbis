from __future__ import annotations

from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_knowledge_base_deleter,
    require_resource_manager,
)
from orbis_user_api.application.knowledge import (
    create_knowledge_base as create_knowledge_base_service,
)
from orbis_user_api.application.knowledge import (
    delete_knowledge_base,
    delete_source,
    get_knowledge_base,
    get_processing_job,
    list_knowledge_bases,
    list_sources,
    publish_note_source,
    retry_processing_job,
    update_knowledge_base,
    upload_file_source,
)
from orbis_user_api.models.knowledge import KnowledgeBase, ProcessingJob
from orbis_user_api.models.user import User
from orbis_user_api.schemas.knowledge import (
    KnowledgeBaseCreateRequest,
    KnowledgeBaseListResponse,
    KnowledgeBaseOut,
    KnowledgeBaseUpdateRequest,
    KnowledgeSourceListResponse,
    ProcessingJobOut,
    SourceIntakeAccepted,
)
from orbis_user_api.services.exceptions import (
    DuplicateKnowledgeSource,
    EventPublishFailed,
    KnowledgeBaseConfirmationInvalid,
    KnowledgeBaseNotFound,
    KnowledgeCleanupFailed,
    NoteNotFound,
    ProcessingJobNotFound,
    ProcessingJobRetryInvalid,
    SourceNotFound,
    SourceTypeUnsupported,
    UserWorkspaceMissing,
)

router = APIRouter(tags=["knowledge"])


def _workspace_forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Active workspace membership required",
    )


def _duplicate_source(error: DuplicateKnowledgeSource) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "Duplicate source content",
            "existing_source_id": str(error.source_id),
            "filename": error.filename,
            "processing_status": error.processing_status,
        },
    )


@router.get("/knowledge-bases", response_model=KnowledgeBaseListResponse)
async def get_knowledge_bases(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBaseListResponse:
    try:
        return KnowledgeBaseListResponse(
            items=await list_knowledge_bases(user, session)
        )
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/knowledge-bases",
    response_model=KnowledgeBaseOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_knowledge_base(
    payload: KnowledgeBaseCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBase:
    try:
        return await create_knowledge_base_service(payload, user, session)
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseOut)
async def read_knowledge_base(
    knowledge_base_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBase:
    try:
        return await get_knowledge_base(knowledge_base_id, user, session)
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.patch(
    "/knowledge-bases/{knowledge_base_id}",
    response_model=KnowledgeBaseOut,
    dependencies=[Depends(require_resource_manager)],
)
async def edit_knowledge_base(
    knowledge_base_id: UUID,
    payload: KnowledgeBaseUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBase:
    try:
        return await update_knowledge_base(knowledge_base_id, payload, user, session)
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.delete(
    "/knowledge-bases/{knowledge_base_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_knowledge_base_deleter)],
)
async def remove_knowledge_base(
    knowledge_base_id: UUID,
    request: Request,
    confirmation: str = Query(min_length=1, max_length=160),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_knowledge_base(
            knowledge_base_id,
            confirmation,
            request.app.state.index_cleanup,
            request.app.state.storage,
            user,
            session,
        )
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except KnowledgeBaseConfirmationInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Knowledge base deletion confirmation does not match",
        ) from None
    except KnowledgeCleanupFailed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Knowledge base cleanup failed",
        ) from None


@router.post(
    "/knowledge-bases/{knowledge_base_id}/sources/files",
    response_model=SourceIntakeAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_resource_manager)],
)
async def upload_knowledge_file(
    knowledge_base_id: UUID,
    request: Request,
    upload: UploadFile = File(alias="file"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await upload_file_source(
            knowledge_base_id,
            upload,
            request.app.state.event_publisher,
            request.app.state.storage,
            user,
            session,
        )
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except SourceTypeUnsupported:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Supported file types are Markdown, TXT, PDF, and DOCX",
        ) from None
    except DuplicateKnowledgeSource as error:
        raise _duplicate_source(error) from None
    except EventPublishFailed as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.details,
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/knowledge-bases/{knowledge_base_id}/sources/notes/{note_id}",
    response_model=SourceIntakeAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_resource_manager)],
)
async def publish_note_to_knowledge_base(
    knowledge_base_id: UUID,
    note_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await publish_note_source(
            knowledge_base_id,
            note_id,
            request.app.state.event_publisher,
            request.app.state.storage,
            user,
            session,
        )
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except NoteNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Note not found"
        ) from None
    except DuplicateKnowledgeSource as error:
        raise _duplicate_source(error) from None
    except EventPublishFailed as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.details,
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get(
    "/knowledge-bases/{knowledge_base_id}/sources",
    response_model=KnowledgeSourceListResponse,
)
async def get_knowledge_sources(
    knowledge_base_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeSourceListResponse:
    try:
        return KnowledgeSourceListResponse(
            items=await list_sources(knowledge_base_id, user, session)
        )
    except KnowledgeBaseNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.delete(
    "/knowledge-bases/{knowledge_base_id}/sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_resource_manager)],
)
async def remove_knowledge_source(
    knowledge_base_id: UUID,
    source_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_source(
            knowledge_base_id,
            source_id,
            request.app.state.index_cleanup,
            request.app.state.storage,
            user,
            session,
        )
    except (KnowledgeBaseNotFound, SourceNotFound):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge source not found"
        ) from None
    except KnowledgeCleanupFailed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Knowledge source cleanup failed",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/processing-jobs/{job_id}", response_model=ProcessingJobOut)
async def read_processing_job(
    job_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    try:
        return await get_processing_job(job_id, user, session)
    except ProcessingJobNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Processing job not found"
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/processing-jobs/{job_id}/retry",
    response_model=ProcessingJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_resource_manager)],
)
async def retry_failed_processing_job(
    job_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessingJob:
    try:
        return await retry_processing_job(
            job_id, request.app.state.event_publisher, user, session
        )
    except ProcessingJobNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Processing job not found"
        ) from None
    except ProcessingJobRetryInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only failed processing jobs can be retried",
        ) from None
    except EventPublishFailed as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.details,
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
