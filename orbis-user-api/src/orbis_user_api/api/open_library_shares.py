from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_session
from orbis_user_api.application.document_shares import (
    ScopeAcknowledgementRequired,
    ShareSigningUnavailable,
    ShareUnavailable,
    create_share,
    recover_share_path,
    revoke_share,
)
from orbis_user_api.application.integration_auth import (
    IntegrationPrincipal,
    error,
    integration_principal,
)
from orbis_user_api.application.notes import _get_active_notebook
from orbis_user_api.models.document_share import DocumentShare
from orbis_user_api.schemas.document_share import ShareCreateRequest, ShareOut
from orbis_user_api.services.exceptions import NotebookNotFound

router = ApiRouter(tags=["open-library-shares"])


async def authorize(principal, notebook_id, session):
    principal.require("shares:manage")
    if principal.token.note_id or (
        principal.token.notebook_id and principal.token.notebook_id != notebook_id
    ):
        raise error(
            403,
            "INTEGRATION_SHARE_SCOPE_FORBIDDEN",
            "实时分享包含未来子文档，需要覆盖整个笔记本的授权范围",
        )
    try:
        await _get_active_notebook(notebook_id, principal.workspace.id, session)
    except NotebookNotFound:
        raise error(404, "NOTEBOOK_NOT_FOUND", "笔记本不存在") from None


@router.get("/shares")
async def list_shares(
    request: Request,
    notebook_id: UUID,
    limit: int = Query(default=20, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await authorize(principal, notebook_id, session)
    rows = list(
        await session.scalars(
            select(DocumentShare)
            .where(
                DocumentShare.workspace_id == principal.workspace.id,
                DocumentShare.notebook_id == notebook_id,
            )
            .order_by(DocumentShare.created_at_ms, DocumentShare.id)
            .offset(cursor)
            .limit(limit + 1)
        )
    )
    return {
        "items": [
            {
                **ShareOut.model_validate(row).model_dump(mode="json"),
                "path": recover_share_path(
                    row, request.app.state.settings.action_token_secret
                ),
            }
            for row in rows[:limit]
        ],
        "next_cursor": cursor + limit if len(rows) > limit else None,
        "has_more": len(rows) > limit,
    }


@router.post("/shares", status_code=201)
async def create(
    request: Request,
    payload: ShareCreateRequest,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await authorize(principal, payload.notebook_id, session)
    try:
        share, token = await create_share(
            payload,
            principal.user,
            session,
            secret=request.app.state.settings.action_token_secret,
        )
        return {
            **ShareOut.model_validate(share).model_dump(mode="json"),
            "path": f"/share/{token}",
            "behavior": "live",
            "includes_future_descendants": True,
        }
    except ShareSigningUnavailable:
        raise error(
            503, "SHARE_SIGNING_UNAVAILABLE", "分享签名密钥未正确配置，请联系管理员"
        ) from None
    except ScopeAcknowledgementRequired:
        raise error(
            422,
            "SHARE_SCOPE_ACKNOWLEDGEMENT_REQUIRED",
            "必须明确确认此范围及未来子文档公开",
        ) from None
    except ShareUnavailable:
        raise error(404, "SHARE_SCOPE_UNAVAILABLE", "分享范围不可用") from None


@router.post("/shares/{share_id}/revoke")
async def revoke(
    share_id: UUID,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    share = await session.get(DocumentShare, share_id)
    if share is None or share.workspace_id != principal.workspace.id:
        raise error(404, "SHARE_NOT_FOUND", "分享不存在")
    await authorize(principal, share.notebook_id, session)
    try:
        return ShareOut.model_validate(
            await revoke_share(share_id, principal.user, session)
        ).model_dump(mode="json")
    except ShareUnavailable:
        raise error(404, "SHARE_NOT_FOUND", "分享不存在") from None
