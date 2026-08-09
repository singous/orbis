from __future__ import annotations

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
from orbis_user_api.models.note import Notebook
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    NotebookCreateRequest,
    NotebookOut,
    NotebookUpdateRequest,
    ResourceStatus,
)
from orbis_user_api.services.exceptions import (
    ArchiveRestoreDependencyInactive,
    DefaultDocumentGroupMissing,
    DocumentGroupNotFound,
    NotebookNotFound,
    UserWorkspaceMissing,
)
from orbis_user_api.services.notebook import create_notebook as create_notebook_service
from orbis_user_api.services.notebook import list_notebooks as list_notebooks_service
from orbis_user_api.services.notebook import set_notebook_archived
from orbis_user_api.services.notebook import update_notebook as update_notebook_service

router = ApiRouter(prefix="/notebooks", tags=["notebooks"])


@router.get("", response_model=PageData[NotebookOut])
async def list_notebooks(
    group_id: UUID | None = Query(default=None),
    resource_status: ResourceStatus = Query(default="active", alias="status"),
    include_inactive_parents: bool = Query(default=False),
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[NotebookOut]:
    try:
        items, total = await list_notebooks_service(
            user,
            session,
            group_id,
            resource_status,
            include_inactive_parents,
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
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="USER_WORKSPACE_MISSING",
            message="用户未绑定可用工作空间",
        ) from None


@router.post(
    "",
    response_model=NotebookOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_notebook(
    payload: NotebookCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notebook:
    try:
        return await create_notebook_service(payload, user, session)
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="USER_WORKSPACE_MISSING",
            message="用户未绑定可用工作空间",
        ) from None
    except DefaultDocumentGroupMissing:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="DEFAULT_DOCUMENT_GROUP_MISSING",
            message="默认文档分组不存在",
        ) from None
    except DocumentGroupNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_GROUP_NOT_FOUND",
            message="文档分组不存在",
        ) from None


@router.patch(
    "/{notebook_id}",
    response_model=NotebookOut,
    dependencies=[Depends(require_resource_manager)],
)
async def update_notebook(
    notebook_id: UUID,
    payload: NotebookUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notebook:
    try:
        return await update_notebook_service(notebook_id, payload, user, session)
    except NotebookNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOTEBOOK_NOT_FOUND",
            message="文集不存在",
        ) from None
    except DocumentGroupNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_GROUP_NOT_FOUND",
            message="文档分组不存在",
        ) from None
    except DefaultDocumentGroupMissing:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="DEFAULT_DOCUMENT_GROUP_MISSING",
            message="默认文档分组不存在",
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None


async def _change_archive_status(
    notebook_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> Notebook:
    try:
        return await set_notebook_archived(notebook_id, archived, user, session)
    except ArchiveRestoreDependencyInactive:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ARCHIVE_RESTORE_DEPENDENCY_INACTIVE",
            message="请先恢复上级文档分组",
        ) from None
    except NotebookNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOTEBOOK_NOT_FOUND",
            message="文集不存在",
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None


@router.post(
    "/{notebook_id}/archive",
    response_model=NotebookOut,
    dependencies=[Depends(require_resource_manager)],
)
async def archive_notebook(
    notebook_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notebook:
    return await _change_archive_status(notebook_id, True, user, session)


@router.post(
    "/{notebook_id}/restore",
    response_model=NotebookOut,
    dependencies=[Depends(require_resource_manager)],
)
async def restore_notebook(
    notebook_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notebook:
    return await _change_archive_status(notebook_id, False, user, session)
