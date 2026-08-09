from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import UploadFile


def safe_filename(filename: str | None) -> str:
    raw = filename or "uploaded-file"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip(".-")
    return cleaned or "uploaded-file"


class LocalFileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    async def save_upload(self, upload: UploadFile, storage_key: str) -> tuple[int, str]:
        target = self.root / storage_key
        target.parent.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256()
        size = 0
        with target.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                output.write(chunk)
        return size, digest.hexdigest()
