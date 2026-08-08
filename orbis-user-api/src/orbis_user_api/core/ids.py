from __future__ import annotations

from uuid import UUID

from uuid6 import uuid7


def new_uuidv7() -> UUID:
    return uuid7()
