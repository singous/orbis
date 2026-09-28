from __future__ import annotations

import base64
import io
import logging
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.infrastructure.image_thumbnail import normalize_thumbnail
from orbis_user_api.models.user import User
from orbis_user_api.schemas.user import UserProfileUpdate
from orbis_user_api.services.storage import LocalFileStorage

logger = logging.getLogger(__name__)
MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024


class AvatarTooLarge(Exception):
    pass


class AvatarNotFound(Exception):
    pass


def avatar_storage_key(user_id: UUID, file_id: UUID) -> str:
    return f"users/{user_id}/avatars/{file_id}/avatar.webp"


async def update_profile(
    payload: UserProfileUpdate, user: User, session: AsyncSession
) -> User:
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, name, value)
    user.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(user)
    logger.info("User profile updated user_id=%s", user.id)
    return user


async def set_avatar(
    upload: UploadFile | None,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> User:
    user_id = user.id
    previous = user.avatar_file_id
    file_id = None
    if upload is not None:
        contents = await upload.read(MAX_AVATAR_UPLOAD_BYTES + 1)
        if len(contents) > MAX_AVATAR_UPLOAD_BYTES:
            raise AvatarTooLarge
        normalized = await run_in_threadpool(normalize_thumbnail, contents, square=True)
        file_id = new_uuidv7()
        normalized_upload = UploadFile(file=io.BytesIO(normalized), filename="avatar.webp")
        try:
            await storage.save_upload(normalized_upload, avatar_storage_key(user_id, file_id))
        except Exception:
            await run_in_threadpool(storage.resolve(avatar_storage_key(user_id, file_id)).unlink, missing_ok=True)
            raise
        finally:
            await normalized_upload.close()
    try:
        user.avatar_file_id = file_id
        user.updated_at_ms = now_ms()
        await session.commit()
    except Exception:
        await session.rollback()
        if file_id:
            await run_in_threadpool(storage.resolve(avatar_storage_key(user_id, file_id)).unlink, missing_ok=True)
        raise
    await session.refresh(user)
    if previous:
        try:
            await run_in_threadpool(storage.resolve(avatar_storage_key(user_id, previous)).unlink, missing_ok=True)
        except OSError:
            logger.warning("Previous avatar cleanup failed user_id=%s", user.id, exc_info=True)
    logger.info("User avatar updated user_id=%s has_avatar=%s", user.id, bool(file_id))
    return user


async def read_avatar(storage: LocalFileStorage, user: User) -> str:
    if not user.avatar_file_id:
        raise AvatarNotFound
    try:
        contents = await run_in_threadpool(storage.resolve(avatar_storage_key(user.id, user.avatar_file_id)).read_bytes)
    except FileNotFoundError:
        raise AvatarNotFound from None
    return "data:image/webp;base64," + base64.b64encode(contents).decode("ascii")
