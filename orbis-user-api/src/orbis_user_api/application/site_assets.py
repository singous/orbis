from __future__ import annotations

import fcntl
import hashlib
import os
import re
import stat
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.models.file import FileAsset
from orbis_user_api.services.file import secure_file_response
from orbis_user_api.services.storage import LocalFileStorage

FILE_REFERENCE_PREFIX = "orbis-file:"
PUBLIC_ASSET_DIRECTORY = "public-assets"
PUBLIC_ASSET_LOCK_FILE = ".public-assets.lock"
COPY_CHUNK_SIZE = 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class PublishedAsset:
    key: str
    filename: str
    media_type: str
    size: int

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.key):
            raise ValueError("Published asset key must be a lowercase SHA-256 digest")
        if not self.filename or not self.media_type or self.size < 0:
            raise ValueError("Published asset metadata is invalid")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class _SourceAssetMissing(Exception):
    pass


class _SourceAssetChanged(Exception):
    pass


class _PublishedCopyCorrupt(Exception):
    pass


def file_reference(file_id: UUID) -> str:
    return f"{FILE_REFERENCE_PREFIX}{file_id}"


def parse_file_reference(value: str) -> UUID | None:
    if not value.startswith(FILE_REFERENCE_PREFIX):
        return None
    raw_id = value[len(FILE_REFERENCE_PREFIX) :]
    try:
        file_id = UUID(raw_id)
    except (ValueError, AttributeError):
        return None
    if value != file_reference(file_id):
        return None
    return file_id


def _hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as input_file:
        while chunk := input_file.read(COPY_CHUNK_SIZE):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def _publication_path(
    storage: LocalFileStorage, key: str, *, create_parent: bool
) -> Path:
    if not SHA256_PATTERN.fullmatch(key):
        raise _PublishedCopyCorrupt
    storage_root = storage.root.resolve()
    public_root = storage_root / PUBLIC_ASSET_DIRECTORY
    try:
        public_root_stat = public_root.lstat()
    except FileNotFoundError:
        if not create_parent:
            raise _PublishedCopyCorrupt from None
        try:
            public_root.mkdir(mode=0o755)
        except FileExistsError:
            pass
        try:
            public_root_stat = public_root.lstat()
        except FileNotFoundError:
            raise _PublishedCopyCorrupt from None
    if stat.S_ISLNK(public_root_stat.st_mode) or not stat.S_ISDIR(
        public_root_stat.st_mode
    ):
        raise _PublishedCopyCorrupt
    public_copy = public_root / key
    if public_copy.parent != public_root:
        raise _PublishedCopyCorrupt
    return public_copy


@contextmanager
def _publication_lock(storage: LocalFileStorage):
    lock_path = storage.root.resolve() / PUBLIC_ASSET_LOCK_FILE
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as exc:
        raise _PublishedCopyCorrupt from exc
    locked = False
    try:
        lock_stat = os.fstat(descriptor)
        if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_nlink != 1:
            raise _PublishedCopyCorrupt
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            locked = True
        except OSError as exc:
            raise _PublishedCopyCorrupt from exc
        yield
    finally:
        if locked:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _validate_public_copy(
    path: Path,
    *,
    size: int,
    sha256: str,
    source: Path | None = None,
) -> None:
    try:
        destination_stat = path.lstat()
        if (
            stat.S_ISLNK(destination_stat.st_mode)
            or not stat.S_ISREG(destination_stat.st_mode)
            or destination_stat.st_nlink != 1
        ):
            raise _PublishedCopyCorrupt
        if source is not None and os.path.samestat(source.stat(), destination_stat):
            raise _PublishedCopyCorrupt
        actual_size, actual_sha256 = _hash_file(path)
    except (FileNotFoundError, IsADirectoryError, OSError) as exc:
        raise _PublishedCopyCorrupt from exc
    if actual_size != size or actual_sha256 != sha256:
        raise _PublishedCopyCorrupt


def _copy_verified_source(
    source: Path,
    storage: LocalFileStorage,
    *,
    expected_size: int,
    expected_sha256: str,
) -> None:
    public_copy = _publication_path(storage, expected_sha256, create_parent=True)
    with _publication_lock(storage):
        public_copy = _publication_path(storage, expected_sha256, create_parent=True)
        temporary = public_copy.parent / f".{public_copy.name}.{uuid4().hex}.tmp"
        digest = hashlib.sha256()
        size = 0
        try:
            with source.open("rb") as input_file, temporary.open("xb") as output_file:
                while chunk := input_file.read(COPY_CHUNK_SIZE):
                    size += len(chunk)
                    digest.update(chunk)
                    output_file.write(chunk)
                output_file.flush()
                os.fsync(output_file.fileno())
            if size != expected_size or digest.hexdigest() != expected_sha256:
                raise _SourceAssetChanged
            temporary.chmod(0o444)
            try:
                os.link(temporary, public_copy)
            except FileExistsError:
                _validate_public_copy(
                    public_copy,
                    size=expected_size,
                    sha256=expected_sha256,
                    source=source,
                )
        except (FileNotFoundError, IsADirectoryError, PermissionError) as exc:
            raise _SourceAssetMissing from exc
        finally:
            temporary.unlink(missing_ok=True)


def _validate_source_metadata(asset: FileAsset) -> None:
    if (
        not asset.storage_key
        or not asset.original_filename
        or not asset.mime_type
        or asset.file_size < 0
        or not SHA256_PATTERN.fullmatch(asset.sha256)
    ):
        raise _SourceAssetChanged


async def prepare_public_asset(
    file_id: UUID,
    workspace_id: UUID,
    session: AsyncSession,
    storage: LocalFileStorage,
) -> PublishedAsset:
    asset = await session.get(FileAsset, file_id)
    if (
        asset is None
        or asset.workspace_id != workspace_id
        or asset.upload_status != "completed"
    ):
        raise SiteError(
            "SITE_ASSET_NOT_FOUND",
            "引用的文件不存在、不属于当前工作空间或尚未完成上传",
            422,
        )
    try:
        _validate_source_metadata(asset)
        source = storage.resolve(asset.storage_key)
        await run_in_threadpool(
            _copy_verified_source,
            source,
            storage,
            expected_size=asset.file_size,
            expected_sha256=asset.sha256,
        )
    except _SourceAssetMissing:
        raise SiteError(
            "SITE_ASSET_NOT_FOUND",
            "引用的文件内容不存在或无法读取",
            422,
        ) from None
    except (ValueError, _SourceAssetChanged):
        raise SiteError(
            "SITE_ASSET_CHANGED",
            "引用的文件内容或元数据已变化，请重新上传后再发布",
            409,
        ) from None
    except _PublishedCopyCorrupt:
        raise SiteError(
            "SITE_ASSET_CORRUPT",
            "已发布资源副本校验失败",
            409,
        ) from None
    return PublishedAsset(
        key=asset.sha256,
        filename=asset.original_filename,
        media_type=asset.mime_type,
        size=asset.file_size,
    )


def public_asset_response(
    asset: PublishedAsset, storage: LocalFileStorage
) -> FileResponse:
    """Build a response after authorization, from a worker thread.

    The caller must first confirm active-release membership. Integrity verification
    reads the complete published file, so async route handlers must invoke this helper
    in a worker thread.
    """
    try:
        with _publication_lock(storage):
            path = _publication_path(storage, asset.key, create_parent=False)
            _validate_public_copy(path, size=asset.size, sha256=asset.key)
    except (ValueError, _PublishedCopyCorrupt):
        raise SiteError(
            "SITE_ASSET_CORRUPT",
            "已发布资源不存在或完整性校验失败",
            404,
        ) from None
    return secure_file_response(
        path,
        filename=asset.filename,
        media_type=asset.media_type,
    )
