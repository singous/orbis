from __future__ import annotations

import re
from uuid import UUID

from fastapi import Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import (
    ApiRouter,
    PageData,
    PaginationParams,
    build_page_data,
)
from orbis_user_api.api.errors import ApiError

from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.application.notes import (
    create_note as create_note_service,
)
from orbis_user_api.application.notes import (
    export_note_markdown,
    get_note,
    get_note_content,
    get_note_tree,
    import_markdown_note,
    search_notes,
    set_note_archived,
    update_note_content,
    update_note_metadata,
)
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    MarkdownExportResponse,
    MarkdownImportRequest,
    NoteContentOut,
    NoteContentUpdateRequest,
    NoteCreateRequest,
    NoteMetadataUpdateRequest,
    NoteOut,
    NoteSearchItem,
    NoteTreeResponse,
    ResourceStatus,
)
from orbis_user_api.services.exceptions import (
    ArchiveRestoreDependencyInactive,
    NotebookNotFound,
    NoteContentInvalid,
    NoteNotFound,
    NoteParentInvalid,
    NoteVersionConflict,
    UserWorkspaceMissing,
)

router = ApiRouter(tags=["notes"])


def _not_found(code: str, message: str) -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code=code,
        message=message,
    )


def _workspace_forbidden() -> ApiError:
    return ApiError(
        status_code=status.HTTP_403_FORBIDDEN,
        code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
        message="需要有效的工作空间成员身份",
    )


@router.get("/notes", response_model=PageData[NoteSearchItem])
async def list_or_search_notes(
    q: str | None = Query(default=None, max_length=240),
    resource_status: ResourceStatus = Query(default="active", alias="status"),
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[NoteSearchItem]:
    try:
        items, total = await search_notes(
            q,
            user,
            session,
            resource_status,
            offset=pagination.offset,
            limit=pagination.page_size,
        )
        return build_page_data(
            items,
            page=pagination.page,
            page_size=pagination.page_size,
            total=total,
        )
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/notes",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_note(
    payload: NoteCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await create_note_service(payload, user, session)
    except NotebookNotFound:
        raise _not_found("NOTEBOOK_NOT_FOUND", "文集不存在") from None
    except NoteParentInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_PARENT_INVALID",
            message="父文档无效",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/notes/import/markdown",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def import_note_from_markdown(
    payload: MarkdownImportRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await import_markdown_note(payload, user, session)
    except NotebookNotFound:
        raise _not_found("NOTEBOOK_NOT_FOUND", "文集不存在") from None
    except NoteParentInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_PARENT_INVALID",
            message="父文档无效",
        ) from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="NOTE_CONTENT_INVALID",
            message="Markdown 文档内容无效",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/notes/{note_id}", response_model=NoteOut)
async def read_note(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await get_note(note_id, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.patch(
    "/notes/{note_id}",
    response_model=NoteOut,
    dependencies=[Depends(require_resource_manager)],
)
async def update_note(
    note_id: UUID,
    payload: NoteMetadataUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    try:
        return await update_note_metadata(note_id, payload, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except NoteParentInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_PARENT_INVALID",
            message="父文档无效",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/notes/{note_id}/content", response_model=NoteContentOut)
async def read_note_content(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteContent:
    try:
        return await get_note_content(note_id, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.put(
    "/notes/{note_id}/content",
    response_model=NoteContentOut,
    dependencies=[Depends(require_resource_manager)],
)
async def save_note_content(
    note_id: UUID,
    payload: NoteContentUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteContent:
    try:
        return await update_note_content(note_id, payload, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="NOTE_CONTENT_INVALID",
            message="文档内容无效",
        ) from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_VERSION_CONFLICT",
            message="文档内容版本冲突，请刷新后重试",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/notes/{note_id}/markdown", response_model=MarkdownExportResponse)
async def export_note_as_markdown(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MarkdownExportResponse:
    try:
        note, markdown = await export_note_markdown(note_id, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    safe_title = re.sub(r"[^\w\-.]+", "-", note.title, flags=re.UNICODE).strip("-")
    return MarkdownExportResponse(
        filename=f"{safe_title or 'note'}.md", markdown=markdown
    )


async def _change_archive_status(
    note_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> Note:
    try:
        return await set_note_archived(note_id, archived, user, session)
    except ArchiveRestoreDependencyInactive:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ARCHIVE_RESTORE_DEPENDENCY_INACTIVE",
            message="请先恢复所有上级资源",
        ) from None
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.post(
    "/notes/{note_id}/archive",
    response_model=NoteOut,
    dependencies=[Depends(require_resource_manager)],
)
async def archive_note(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    return await _change_archive_status(note_id, True, user, session)


@router.post(
    "/notes/{note_id}/restore",
    response_model=NoteOut,
    dependencies=[Depends(require_resource_manager)],
)
async def restore_note(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Note:
    return await _change_archive_status(note_id, False, user, session)


@router.get("/notebooks/{notebook_id}/notes/tree", response_model=NoteTreeResponse)
async def notebook_note_tree(
    notebook_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteTreeResponse:
    try:
        return NoteTreeResponse(items=await get_note_tree(notebook_id, user, session))
    except NotebookNotFound:
        raise _not_found("NOTEBOOK_NOT_FOUND", "文集不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
