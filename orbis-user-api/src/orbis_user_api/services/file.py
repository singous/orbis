from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.user import User
from orbis_user_api.services.storage import LocalFileStorage, safe_filename
from orbis_user_api.services.workspace import get_current_workspace


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


async def list_file_assets(user: User, session: AsyncSession) -> list[FileAsset]:
    result = await session.execute(
        select(FileAsset).where(FileAsset.owner_id == user.id).order_by(FileAsset.created_at_ms.desc())
    )
    return list(result.scalars().all())
