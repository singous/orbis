from __future__ import annotations

import hashlib
import json
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_session
from orbis_user_api.application.integration_auth import (
    IntegrationPrincipal,
    error,
    integration_principal,
)
from orbis_user_api.application.integration_files import authorized_file
from orbis_user_api.application.library_operations import receipt, refresh_principal
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.integration import (
    IntegrationAttachment,
    IntegrationOperation,
    IntegrationToken,
)
from orbis_user_api.services.file import secure_file_response
from orbis_user_api.services.storage import safe_filename

router = ApiRouter(tags=["open-library-files"])
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def file_public(asset):
    return {
        "id": str(asset.id),
        "original_filename": asset.original_filename,
        "mime_type": asset.mime_type,
        "file_size": asset.file_size,
        "sha256": asset.sha256,
        "upload_status": asset.upload_status,
        "url": f"/files/{asset.id}/content",
    }


@router.post("/notes/{note_id}/files", status_code=201)
async def upload(
    note_id: UUID,
    request: Request,
    operation_id: UUID = Form(),
    sha256: str = Form(min_length=64, max_length=64),
    upload: UploadFile = File(alias="file"),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    principal.require("files:write")
    await principal.note(note_id, session, write=True)
    if upload.size is None or upload.size > MAX_UPLOAD_BYTES:
        raise error(413, "UPLOAD_BUDGET_EXCEEDED", "附件最大支持 20 MiB")
    digest = hashlib.sha256(
        json.dumps(
            {
                "action": "upload",
                "note_id": str(note_id),
                "sha256": sha256,
                "name": upload.filename,
                "mime_type": upload.content_type,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    await session.scalar(
        select(IntegrationToken)
        .where(IntegrationToken.id == principal.token.id)
        .with_for_update()
    )
    existing = await receipt(principal, operation_id, session, digest)
    if existing is not None:
        return existing
    file_id = new_uuidv7()
    storage_key = f"{principal.workspace.id}/{file_id}/{safe_filename(upload.filename)}"
    storage = request.app.state.storage
    path = storage.resolve(storage_key)
    try:
        size, actual_sha = await storage.save_upload(upload, storage_key)
        if size > MAX_UPLOAD_BYTES or actual_sha != sha256:
            raise error(422, "UPLOAD_DIGEST_MISMATCH", "附件大小或 SHA-256 校验不一致")
        asset = FileAsset(
            id=file_id,
            workspace_id=principal.workspace.id,
            owner_id=principal.user.id,
            storage_key=storage_key,
            original_filename=upload.filename or "uploaded-file",
            mime_type=upload.content_type or "application/octet-stream",
            file_size=size,
            sha256=actual_sha,
            upload_status="completed",
        )
        session.add(asset)
        session.add(
            IntegrationAttachment(
                file_id=file_id, note_id=note_id, workspace_id=principal.workspace.id
            )
        )
        result = {
            **file_public(asset),
            "note_id": str(note_id),
            "operation_id": str(operation_id),
            "durability": "committed",
            "block_template": {
                "type": "file",
                "props": {
                    "url": f"orbis-file:{file_id}",
                    "name": asset.original_filename,
                },
                "content": [],
            },
        }
        session.add(
            IntegrationOperation(
                token_id=principal.token.id,
                operation_id=operation_id,
                workspace_id=principal.workspace.id,
                note_id=note_id,
                request_hash=digest,
                result=result,
            )
        )
        await session.commit()
        return result
    except IntegrityError:
        await session.rollback()
        path.unlink(missing_ok=True)
        await refresh_principal(principal, session)
        existing = await receipt(principal, operation_id, session, digest)
        if existing is not None:
            return existing
        raise error(409, "UPLOAD_CONFLICT", "上传冲突，请查询原操作结果") from None
    except BaseException:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise


@router.get("/notes/{note_id}/files/{file_id}")
async def metadata(
    note_id: UUID,
    file_id: UUID,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return file_public(await authorized_file(principal, note_id, file_id, session))


async def download(
    note_id: UUID,
    file_id: UUID,
    request: Request,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    asset = await authorized_file(principal, note_id, file_id, session)
    path = request.app.state.storage.resolve(asset.storage_key)
    if not path.is_file():
        raise error(404, "FILE_NOT_FOUND", "文件内容不存在")
    return secure_file_response(
        path, filename=asset.original_filename, media_type=asset.mime_type
    )


APIRouter.add_api_route(
    router,
    "/notes/{note_id}/files/{file_id}/content",
    download,
    methods=["GET"],
    response_class=FileResponse,
    response_model=None,
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
