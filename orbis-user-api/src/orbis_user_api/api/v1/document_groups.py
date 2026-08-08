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
from orbis_user_api.models.note import NoteGroup
from orbis_user_api.models.user import User
from orbis_user_api.schemas.note import (
    DocumentGroupCreateRequest,
    DocumentGroupOut,
    DocumentGroupUpdateRequest,
    ResourceStatus,
)
from orbis_user_api.services.document_group import (
    create_document_group as create_document_group_service,
)
from orbis_user_api.services.document_group import (
    list_document_groups as list_document_groups_service,
)
from orbis_user_api.services.document_group import set_document_group_archived
from orbis_user_api.services.document_group import (
    update_document_group as update_document_group_service,
)
from orbis_user_api.services.exceptions import (
    DefaultDocumentGroupArchiveForbidden,
    DocumentGroupNotFound,
    UserWorkspaceMissing,
)

router = ApiRouter(prefix="/document-groups", tags=["document-groups"])


@router.get("", response_model=PageData[DocumentGroupOut])
async def list_document_groups(
    resource_status: ResourceStatus = Query(default="active", alias="status"),
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[DocumentGroupOut]:
    try:
        items, total = await list_document_groups_service(
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
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="USER_WORKSPACE_MISSING",
            message="用户未绑定可用工作空间",
        ) from None


@router.post(
    "",
    response_model=DocumentGroupOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_resource_manager)],
)
async def create_document_group(
    payload: DocumentGroupCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteGroup:
    try:
        return await create_document_group_service(payload, user, session)
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="USER_WORKSPACE_MISSING",
            message="用户未绑定可用工作空间",
        ) from None


@router.patch(
    "/{group_id}",
    response_model=DocumentGroupOut,
    dependencies=[Depends(require_resource_manager)],
)
async def update_document_group(
    group_id: UUID,
    payload: DocumentGroupUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteGroup:
    try:
        return await update_document_group_service(group_id, payload, user, session)
    except DocumentGroupNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_GROUP_NOT_FOUND",
            message="文档分组不存在",
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None


async def _change_archive_status(
    group_id: UUID,
    archived: bool,
    user: User,
    session: AsyncSession,
) -> NoteGroup:
    try:
        return await set_document_group_archived(group_id, archived, user, session)
    except DefaultDocumentGroupArchiveForbidden:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="DEFAULT_DOCUMENT_GROUP_ARCHIVE_FORBIDDEN",
            message="默认文档分组不能归档",
        ) from None
    except DocumentGroupNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_GROUP_NOT_FOUND",
            message="文档分组不存在",
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None


@router.post(
    "/{group_id}/archive",
    response_model=DocumentGroupOut,
    dependencies=[Depends(require_resource_manager)],
)
async def archive_document_group(
    group_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteGroup:
    return await _change_archive_status(group_id, True, user, session)


@router.post(
    "/{group_id}/restore",
    response_model=DocumentGroupOut,
    dependencies=[Depends(require_resource_manager)],
)
async def restore_document_group(
    group_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteGroup:
    return await _change_archive_status(group_id, False, user, session)
