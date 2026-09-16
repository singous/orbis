from __future__ import annotations

import base64
import io
import logging
import warnings
from uuid import UUID

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.user import User
from orbis_user_api.schemas.notebook_icon import (
    ImageNotebookIcon,
    NotebookIcon,
    NotebookIconImageOut,
    NotebookIconUploadOut,
)
from orbis_user_api.services.storage import LocalFileStorage
from orbis_user_api.services.workspace import get_current_workspace

logger = logging.getLogger(__name__)

MAX_ICON_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_ICON_IMAGE_PIXELS = 4096 * 4096
ICON_THUMBNAIL_SIZE = (256, 256)
ALLOWED_ICON_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
ICON_MIME_TYPE = "image/webp"


class NotebookIconInvalidImage(Exception):
    pass


class NotebookIconTooLarge(Exception):
    pass


class NotebookIconNotFound(Exception):
    pass


def _storage_key(workspace_id: UUID, file_id: UUID) -> str:
    return f"{workspace_id}/notebook-icons/{file_id}/icon.webp"


def _normalize_image(contents: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(contents)) as source:
                if (
                    source.format not in ALLOWED_ICON_FORMATS
                    or source.width * source.height > MAX_ICON_IMAGE_PIXELS
                    or getattr(source, "is_animated", False)
                ):
                    raise NotebookIconInvalidImage
                source.verify()
            with Image.open(io.BytesIO(contents)) as source:
                source.load()
                oriented = ImageOps.exif_transpose(source).convert("RGBA")
                oriented.thumbnail(ICON_THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                clean = Image.new("RGBA", oriented.size)
                clean.paste(oriented)
                output = io.BytesIO()
                clean.save(output, format="WEBP", lossless=True)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise NotebookIconInvalidImage from exc


def _data_url(contents: bytes) -> str:
    return f"data:{ICON_MIME_TYPE};base64,{base64.b64encode(contents).decode('ascii')}"


async def get_notebook_icon_asset(
    file_id: UUID, workspace_id: UUID, session: AsyncSession
) -> FileAsset:
    asset = await session.get(FileAsset, file_id)
    if (
        asset is None
        or asset.workspace_id != workspace_id
        or asset.storage_key != _storage_key(workspace_id, file_id)
        or asset.mime_type != ICON_MIME_TYPE
        or asset.upload_status != "completed"
    ):
        raise NotebookIconNotFound
    return asset


async def validate_notebook_icon(
    icon: NotebookIcon | None, workspace_id: UUID, session: AsyncSession
) -> None:
    if isinstance(icon, ImageNotebookIcon):
        await get_notebook_icon_asset(icon.file_id, workspace_id, session)


async def upload_notebook_icon(
    upload: UploadFile,
    storage: LocalFileStorage,
    user: User,
    session: AsyncSession,
) -> NotebookIconUploadOut:
    workspace, _ = await get_current_workspace(user, session)
    contents = await upload.read(MAX_ICON_UPLOAD_BYTES + 1)
    if len(contents) > MAX_ICON_UPLOAD_BYTES:
        raise NotebookIconTooLarge
    normalized = await run_in_threadpool(_normalize_image, contents)
    file_id = new_uuidv7()
    storage_key = _storage_key(workspace.id, file_id)
    normalized_upload = UploadFile(file=io.BytesIO(normalized), filename="icon.webp")
    try:
        file_size, sha256 = await storage.save_upload(normalized_upload, storage_key)
        session.add(
            FileAsset(
                id=file_id,
                workspace_id=workspace.id,
                owner_id=user.id,
                storage_key=storage_key,
                original_filename="icon.webp",
                mime_type=ICON_MIME_TYPE,
                file_size=file_size,
                sha256=sha256,
                upload_status="completed",
            )
        )
        await session.commit()
    except Exception:
        await session.rollback()
        (storage.root / storage_key).unlink(missing_ok=True)
        raise
    finally:
        await normalized_upload.close()
    logger.info(
        "Notebook icon uploaded workspace_id=%s file_id=%s size_bytes=%s",
        workspace.id,
        file_id,
        file_size,
    )
    return NotebookIconUploadOut(file_id=file_id, data_url=_data_url(normalized))


async def read_notebook_icon(
    file_id: UUID, storage: LocalFileStorage, user: User, session: AsyncSession
) -> NotebookIconImageOut:
    workspace, _ = await get_current_workspace(user, session)
    asset = await get_notebook_icon_asset(file_id, workspace.id, session)
    try:
        contents = await run_in_threadpool(
            (storage.root / asset.storage_key).read_bytes
        )
    except FileNotFoundError:
        logger.warning(
            "Notebook icon file missing workspace_id=%s file_id=%s",
            workspace.id,
            file_id,
        )
        raise NotebookIconNotFound from None
    return NotebookIconImageOut(data_url=_data_url(contents))
