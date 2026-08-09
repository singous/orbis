from __future__ import annotations

from datetime import UTC, datetime


def now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)
