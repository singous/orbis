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
from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.note_content_pages import (
    get_note_content_outline,
    get_note_content_page,
    save_note_content_prefix,
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
    reorder_notes,
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
    NoteBlockChangesOut,
    NoteBlockChangesRequest,
    NoteBlockOut,
    NoteChildrenPageOut,
    NoteContentOut,
    NoteContentOutlineOut,
    NoteContentPageOut,
    NoteContentPrefixOut,
    NoteContentPrefixRequest,
    NoteContentUpdateRequest,
    NoteCreateRequest,
    NoteMetadataUpdateRequest,
    NoteOrderRequest,
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
    NoteOrderConflict,
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


@router.get(
    "/notes/{note_id}/content", response_model=NoteContentOut | NoteContentPageOut
)
async def read_note_content(
    note_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    offset: int = Query(default=0, ge=0),
    limit: int | None = Query(default=None, ge=1, le=64),
    expected_version: int | None = Query(default=None, ge=1),
) -> NoteContent | NoteContentPageOut:
    try:
        if limit is not None:
            return await get_note_content_page(
                note_id,
                user,
                session,
                offset=offset,
                limit=limit,
                version=expected_version,
            )
        return await get_note_content(note_id, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="文档已更新，请重新载入正文。",
        ) from None


@router.patch(
    "/notes/{note_id}/content",
    response_model=NoteContentPrefixOut,
    dependencies=[Depends(require_resource_manager)],
)
async def save_loaded_note_content(
    note_id: UUID,
    payload: NoteContentPrefixRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteContentPrefixOut:
    try:
        return await save_note_content_prefix(note_id, payload, user, session)
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=422, code="NOTE_CONTENT_INVALID", message="文档内容无效"
        ) from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="文档内容版本冲突，本地草稿仍保留。",
        ) from None


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


@router.put(
    "/notebooks/{notebook_id}/notes/order",
    response_model=NoteTreeResponse,
    dependencies=[Depends(require_resource_manager)],
)
async def reorder_notebook_notes(
    notebook_id: UUID,
    payload: NoteOrderRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteTreeResponse:
    try:
        return NoteTreeResponse(
            items=await reorder_notes(notebook_id, payload, user, session)
        )
    except NotebookNotFound:
        raise _not_found("NOTEBOOK_NOT_FOUND", "文集不存在") from None
    except NoteParentInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_PARENT_INVALID",
            message="父文档无效",
        ) from None
    except NoteOrderConflict:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOTE_ORDER_CONFLICT",
            message="文档目录已变化，请刷新后重试排序",
        ) from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.get("/notes/{note_id}/content/outline", response_model=NoteContentOutlineOut)
async def read_note_outline(
    note_id: UUID,
    version: int = Query(ge=1),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        return await get_note_content_outline(note_id, user, session, version)
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="请求的文档内容快照已不可用",
        ) from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=422, code="NOTE_CONTENT_INVALID", message="文档内容无效"
        ) from None
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None


@router.patch(
    "/notes/{note_id}/blocks",
    response_model=NoteBlockChangesOut,
    dependencies=[Depends(require_resource_manager)],
)
async def save_note_block_changes(
    note_id: UUID,
    payload: NoteBlockChangesRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from orbis_user_api.application.block_content import BlockContentStore

    try:
        note = await get_note(note_id, user, session)
        return await BlockContentStore(session, note).changes(
            payload.expected_version,
            payload.upserts,
            [move.model_dump() for move in payload.moves],
            payload.deletes,
            user,
        )
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    except NoteVersionConflict:
        await session.rollback()
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="文档内容版本冲突，本地草稿仍保留。",
        ) from None
    except NoteContentInvalid:
        await session.rollback()
        raise ApiError(
            status_code=422,
            code="NOTE_CONTENT_INVALID",
            message="块变更、父级或排序关系无效",
        ) from None


@router.get("/notes/{note_id}/content/children", response_model=NoteChildrenPageOut)
async def read_note_children(
    note_id: UUID,
    parent_id: str | None = Query(default=None, max_length=512),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=32, ge=1, le=256),
    expected_version: int | None = Query(default=None, ge=1),
    max_bytes: int = Query(default=131072, ge=4096, le=1048576),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from orbis_user_api.application.block_content import BlockContentStore

    try:
        note = await get_note(note_id, user, session)
        return await BlockContentStore(session, note).children(
            parent_id, offset, limit, expected_version, max_bytes
        )
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409, code="NOTE_VERSION_CONFLICT", message="文档内容快照不可用"
        ) from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=422, code="NOTE_CONTENT_INVALID", message="父块或内容无效"
        ) from None


@router.get("/notes/{note_id}/blocks/{block_id}", response_model=NoteBlockOut)
async def read_note_block(
    note_id: UUID,
    block_id: str,
    expected_version: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from orbis_user_api.application.block_content import BlockContentStore

    try:
        note = await get_note(note_id, user, session)
        return await BlockContentStore(session, note).block(
            block_id, expected_version, read_lock=True
        )
    except NoteNotFound:
        raise _not_found("NOTE_NOT_FOUND", "文档或块不存在") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409, code="NOTE_VERSION_CONFLICT", message="文档内容快照不可用"
        ) from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=422, code="NOTE_CONTENT_INVALID", message="文档内容无效"
        ) from None
