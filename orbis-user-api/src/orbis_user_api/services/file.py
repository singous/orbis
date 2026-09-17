from __future__ import annotations

import os
import re
import stat
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import MalformedRangeHeader, RangeNotSatisfiable

from orbis_user_api.api.errors import ApiError
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.user import User
from orbis_user_api.services.exceptions import UserWorkspaceMissing
from orbis_user_api.services.storage import LocalFileStorage, safe_filename
from orbis_user_api.services.workspace import get_current_workspace

SAFE_INLINE_MEDIA_TYPES = frozenset(
    {
        "image/avif",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
        "audio/aac",
        "audio/flac",
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "video/mp4",
        "video/ogg",
        "video/quicktime",
        "video/webm",
    }
)
SAFE_ATTACHMENT_MEDIA_TYPES = frozenset({"text/plain"})
SECURE_FILE_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
}


class FileAssetNotFound(Exception):
    pass


class SecureFileResponse(FileResponse):
    async def __call__(self, scope: dict[str, Any], receive, send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            http_range = headers.get("range")
            http_if_range = headers.get("if-range")
            if http_range is not None:
                stat_result = self.stat_result
                if stat_result is None:
                    stat_result = await run_in_threadpool(os.stat, self.path)
                    if not stat.S_ISREG(stat_result.st_mode):
                        raise RuntimeError(f"File at path {self.path} is not a file.")
                    self.set_stat_headers(stat_result)
                    self.stat_result = stat_result
            if http_range is not None and (
                http_if_range is None or self._should_use_range(http_if_range)
            ):
                try:
                    self._parse_range_header(http_range, stat_result.st_size)
                except MalformedRangeHeader:
                    raise ApiError(
                        status_code=400,
                        code="INVALID_RANGE",
                        message="Range 请求头格式无效",
                        headers=dict(SECURE_FILE_HEADERS),
                    ) from None
                except RangeNotSatisfiable as error:
                    raise ApiError(
                        status_code=416,
                        code="RANGE_NOT_SATISFIABLE",
                        message="请求的文件范围无法满足",
                        headers={
                            **SECURE_FILE_HEADERS,
                            "Content-Range": f"bytes */{error.max_size}",
                        },
                    ) from None
        await super().__call__(scope, receive, send)


def _download_filename(filename: str) -> str:
    basename = re.split(r"[/\\]", filename)[-1]
    cleaned = "".join(
        character
        for character in basename
        if ord(character) >= 32 and ord(character) != 127
    ).strip()
    return cleaned[:255] or "download"


def secure_file_response(path: Path, *, filename: str, media_type: str) -> FileResponse:
    normalized_type = media_type.partition(";")[0].strip().lower()
    if normalized_type in SAFE_INLINE_MEDIA_TYPES:
        response_type = normalized_type
        disposition = "inline"
    elif normalized_type in SAFE_ATTACHMENT_MEDIA_TYPES:
        response_type = normalized_type
        disposition = "attachment"
    else:
        response_type = "application/octet-stream"
        disposition = "attachment"
    return SecureFileResponse(
        path,
        media_type=response_type,
        filename=_download_filename(filename),
        content_disposition_type=disposition,
        headers=SECURE_FILE_HEADERS,
    )


async def get_workspace_file_asset(
    file_id: UUID, user: User, session: AsyncSession
) -> FileAsset:
    try:
        workspace, _membership = await get_current_workspace(user, session)
    except UserWorkspaceMissing:
        raise FileAssetNotFound from None
    asset = await session.get(FileAsset, file_id)
    if (
        asset is None
        or asset.workspace_id != workspace.id
        or asset.upload_status != "completed"
    ):
        raise FileAssetNotFound
    return asset


async def read_file_asset(
    file_id: UUID,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> FileResponse:
    asset = await get_workspace_file_asset(file_id, user, session)
    try:
        path = storage.resolve(asset.storage_key)
    except ValueError:
        raise FileAssetNotFound from None
    if not path.is_file():
        raise FileAssetNotFound
    return secure_file_response(
        path,
        filename=asset.original_filename,
        media_type=asset.mime_type,
    )


async def upload_file_asset(
    upload: UploadFile,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> FileAsset:
    workspace, _ = await get_current_workspace(user, session)
    file_id = new_uuidv7()
    filename = safe_filename(upload.filename)
    storage_key = f"{workspace.id}/{file_id}/{filename}"
    file_size, sha256 = await storage.save_upload(upload, storage_key)

    file_asset = FileAsset(
        id=file_id,
        workspace_id=workspace.id,
        owner_id=user.id,
        storage_key=storage_key,
        original_filename=upload.filename or filename,
        mime_type=upload.content_type or "application/octet-stream",
        file_size=file_size,
        sha256=sha256,
        upload_status="completed",
    )
    session.add(file_asset)
    await session.commit()
    await session.refresh(file_asset)
    return file_asset


async def list_file_assets(
    user: User,
    session: AsyncSession,
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[FileAsset], int]:
    conditions = (FileAsset.owner_id == user.id,)
    total = await session.scalar(select(func.count(FileAsset.id)).where(*conditions))
    result = await session.execute(
        select(FileAsset)
        .where(*conditions)
        .order_by(FileAsset.created_at_ms.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all()), int(total or 0)
