"""Keep public block positions stable when unpublished placeholders are omitted."""

from __future__ import annotations

import re
from typing import Any

PUBLIC_BLOCK_ID = re.compile(r"public-((?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*))*)")


def public_block_path(block: dict[str, Any], fallback: str) -> str:
    identifier = block.get("id")
    match = PUBLIC_BLOCK_ID.fullmatch(identifier) if isinstance(identifier, str) else None
    return match.group(1) if match else fallback
