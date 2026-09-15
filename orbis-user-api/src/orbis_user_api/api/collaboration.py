from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import (
    ApiRouter,
    PageData,
    PaginationParams,
    build_page_data,
)
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application import collaboration
from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import NoteContent
from orbis_user_api.models.user import User
from orbis_user_api.schemas.collaboration import (
    CommentCreateRequest,
    CommentOut,
    CommentUpdateRequest,
    RevisionOut,
    RevisionRestoreRequest,
    RevisionSummary,
)
from orbis_user_api.schemas.note import NoteContentOut
from orbis_user_api.services.exceptions import (
    NotebookNotFound,
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

router = ApiRouter(tags=["collaboration"])

CurrentUser = Annotated[User, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]
Pagination = Annotated[PaginationParams, Depends()]


@contextmanager
def _api_errors() -> Iterator[None]:
    try:
        yield
    except (NoteNotFound, NotebookNotFound):
        raise ApiError(
            status_code=404, code="NOTE_NOT_FOUND", message="文档不存在"
        ) from None
    except collaboration.CommentNotFound:
        raise ApiError(
            status_code=404, code="COMMENT_NOT_FOUND", message="评论不存在"
        ) from None
    except collaboration.RevisionNotFound:
        raise ApiError(
            status_code=404, code="REVISION_NOT_FOUND", message="历史版本不存在"
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=403,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None
    except WorkspaceMemberForbidden:
        raise ApiError(
            status_code=403,
            code="COLLABORATION_FORBIDDEN",
            message="当前账号无权执行此操作",
        ) from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="文档内容版本冲突，请刷新后重试",
        ) from None
    except NoteContentInvalid:
        raise ApiError(
            status_code=422, code="NOTE_CONTENT_INVALID", message="文档内容无效"
        ) from None


@router.get("/notes/{note_id}/comments", response_model=PageData[CommentOut])
async def list_comments(
    note_id: UUID,
    pagination: Pagination,
    user: CurrentUser,
    session: Session,
) -> PageData[CommentOut]:
    with _api_errors():
        items, total = await collaboration.list_comments(
            note_id, user, session, offset=pagination.offset, limit=pagination.page_size
        )
        return build_page_data(
            items, page=pagination.page, page_size=pagination.page_size, total=total
        )


@router.post(
    "/notes/{note_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    note_id: UUID,
    payload: CommentCreateRequest,
    user: CurrentUser,
    session: Session,
) -> CommentOut:
    with _api_errors():
        return await collaboration.create_comment(note_id, payload, user, session)


@router.patch("/notes/{note_id}/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    note_id: UUID,
    comment_id: UUID,
    payload: CommentUpdateRequest,
    user: CurrentUser,
    session: Session,
) -> CommentOut:
    with _api_errors():
        return await collaboration.update_comment(
            note_id, comment_id, payload, user, session
        )


@router.get("/notes/{note_id}/revisions", response_model=PageData[RevisionSummary])
async def list_revisions(
    note_id: UUID,
    pagination: Pagination,
    user: CurrentUser,
    session: Session,
) -> PageData[RevisionSummary]:
    with _api_errors():
        items, total = await collaboration.list_revisions(
            note_id, user, session, offset=pagination.offset, limit=pagination.page_size
        )
        return build_page_data(
            items, page=pagination.page, page_size=pagination.page_size, total=total
        )


@router.get("/notes/{note_id}/revisions/{revision_id}", response_model=RevisionOut)
async def get_revision(
    note_id: UUID,
    revision_id: UUID,
    user: CurrentUser,
    session: Session,
) -> NoteRevision:
    with _api_errors():
        return await collaboration.get_revision(note_id, revision_id, user, session)


@router.post(
    "/notes/{note_id}/revisions/{revision_id}/restore", response_model=NoteContentOut
)
async def restore_revision(
    note_id: UUID,
    revision_id: UUID,
    payload: RevisionRestoreRequest,
    user: CurrentUser,
    session: Session,
) -> NoteContent:
    with _api_errors():
        return await collaboration.restore_revision(
            note_id, revision_id, payload, user, session
        )
