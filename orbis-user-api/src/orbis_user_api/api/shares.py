from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import (
    get_current_user,
    get_session,
    require_resource_manager,
)
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.document_shares import (
    ScopeAcknowledgementRequired,
    ShareSigningUnavailable,
    ShareUnavailable,
    create_share,
    list_shares,
    recover_share_path,
    resolve_share,
    revoke_share,
)
from orbis_user_api.application.shared_content import (
    public_block,
    public_content,
    shared_asset,
)
from orbis_user_api.models.user import User
from orbis_user_api.schemas.document_share import (
    PublicShareOut,
    ShareCreatedOut,
    ShareCreateRequest,
    SharedContentOut,
    ShareListOut,
    ShareOut,
)
from orbis_user_api.schemas.note import NoteBlockOut
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

router = ApiRouter(tags=["document-sharing"])
assets_router = APIRouter(tags=["document-sharing"])
PUBLIC_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
}


def _unavailable() -> ApiError:
    return ApiError(
        status_code=404,
        code="SHARE_NOT_FOUND",
        message="分享不存在、已撤销或文档不在分享范围内",
        headers=PUBLIC_HEADERS,
    )


def _forbidden() -> ApiError:
    return ApiError(
        status_code=403,
        code="RESOURCE_MANAGEMENT_FORBIDDEN",
        message="当前账号无分享管理权限",
    )


@router.post(
    "/shares",
    response_model=ShareCreatedOut,
    status_code=201,
    dependencies=[Depends(require_resource_manager)],
)
async def create_document_share(
    payload: ShareCreateRequest,
    request: Request,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    response.headers.update(PUBLIC_HEADERS)
    try:
        share, token = await create_share(
            payload, user, session, request.app.state.settings.action_token_secret
        )
        return ShareCreatedOut(
            **ShareOut.model_validate(share).model_dump(exclude={"path"}),
            token=token,
            path=f"/share/{token}",
        )
    except ShareUnavailable:
        raise _unavailable() from None
    except ScopeAcknowledgementRequired:
        raise ApiError(
            status_code=422,
            code="SHARE_SCOPE_ACKNOWLEDGEMENT_REQUIRED",
            message="创建前请确认当前范围及未来新增文档将公开",
        ) from None
    except ShareSigningUnavailable:
        raise ApiError(
            status_code=503,
            code="SHARE_SIGNING_UNAVAILABLE",
            message="分享服务尚未配置，请联系管理员",
            headers=PUBLIC_HEADERS,
        ) from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise _forbidden() from None


@router.get(
    "/shares",
    response_model=ShareListOut,
    dependencies=[Depends(require_resource_manager)],
)
async def list_document_shares(
    request: Request,
    response: Response,
    notebook_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    root_note_id: UUID | None = None,
):
    response.headers.update(PUBLIC_HEADERS)
    try:
        records = await list_shares(notebook_id, root_note_id, user, session)
        return ShareListOut(
            items=[
                ShareOut.model_validate(item).model_copy(
                    update={
                        "path": recover_share_path(
                            item, request.app.state.settings.action_token_secret
                        )
                    }
                )
                for item in records
            ]
        )
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise _forbidden() from None


@router.post(
    "/shares/{share_id}/revoke",
    response_model=ShareOut,
    dependencies=[Depends(require_resource_manager)],
)
async def revoke_document_share(
    share_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        return await revoke_share(share_id, user, session)
    except ShareUnavailable:
        raise _unavailable() from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise _forbidden() from None


@router.get("/public/shares/{token}", response_model=PublicShareOut)
async def read_public_share(
    token: str,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    response.headers.update(PUBLIC_HEADERS)
    try:
        return await (await resolve_share(token, session)).manifest(session)
    except ShareUnavailable:
        raise _unavailable() from None


@router.get(
    "/public/shares/{token}/notes/{note_id}/content", response_model=SharedContentOut
)
async def read_public_share_content(
    token: str,
    note_id: UUID,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
    parent_id: str | None = Query(default=None, max_length=512),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=32, ge=1, le=64),
    expected_version: int | None = Query(default=None, ge=1),
):
    response.headers.update(PUBLIC_HEADERS)
    try:
        scope = await resolve_share(token, session)
        return await public_content(
            scope,
            note_id,
            session,
            parent_id=parent_id,
            offset=offset,
            limit=limit,
            expected_version=expected_version,
        )
    except (ShareUnavailable, NoteNotFound, NoteContentInvalid):
        raise _unavailable() from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="SHARE_CONTENT_CHANGED",
            message="在线文档已更新，请重新加载正文",
            headers=PUBLIC_HEADERS,
        ) from None


@assets_router.get(
    "/public/shares/{token}/notes/{note_id}/files/{file_id}",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        }
    },
)
async def read_public_share_file(
    token: str,
    note_id: UUID,
    file_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        scope = await resolve_share(token, session)
        response = await shared_asset(
            scope, note_id, file_id, session, request.app.state.storage
        )
        response.headers.update(PUBLIC_HEADERS)
        return response
    except (ShareUnavailable, NoteNotFound, NoteContentInvalid):
        raise _unavailable() from None


@router.get(
    "/public/shares/{token}/notes/{note_id}/blocks/{block_id}",
    response_model=NoteBlockOut,
)
async def read_public_share_block(
    token: str,
    note_id: UUID,
    block_id: str,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
    expected_version: int | None = Query(default=None, ge=1),
):
    response.headers.update(PUBLIC_HEADERS)
    try:
        scope = await resolve_share(token, session)
        return await public_block(scope, note_id, block_id, session, expected_version)
    except (ShareUnavailable, NoteNotFound, NoteContentInvalid):
        raise _unavailable() from None
    except NoteVersionConflict:
        raise ApiError(
            status_code=409,
            code="SHARE_CONTENT_CHANGED",
            message="在线文档已更新，请重新加载正文",
            headers=PUBLIC_HEADERS,
        ) from None
