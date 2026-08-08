from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

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
    NoteSearchResponse,
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

router = APIRouter(tags=["notes"])


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _workspace_forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Active workspace membership required",
    )


@router.get("/notes", response_model=NoteSearchResponse)
async def list_or_search_notes(
    q: str | None = Query(default=None, max_length=240),
    resource_status: ResourceStatus = Query(default="active", alias="status"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteSearchResponse:
    try:
        return NoteSearchResponse(
            items=await search_notes(q, user, session, resource_status)
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
        raise _not_found("Collection not found") from None
    except NoteParentInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Parent note is invalid"
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
        raise _not_found("Collection not found") from None
    except NoteParentInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Parent note is invalid"
        ) from None
    except NoteContentInvalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Markdown content is invalid",
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
        raise _not_found("Note not found") from None
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
        raise _not_found("Note not found") from None
    except NoteParentInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Parent note is invalid"
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
        raise _not_found("Note not found") from None
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
        raise _not_found("Note not found") from None
    except NoteContentInvalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Note content is invalid",
        ) from None
    except NoteVersionConflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Note content version conflict",
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
        raise _not_found("Note not found") from None
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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Parent resources must be restored first",
        ) from None
    except NoteNotFound:
        raise _not_found("Note not found") from None
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
        raise _not_found("Collection not found") from None
    except UserWorkspaceMissing:
        raise _workspace_forbidden() from None
