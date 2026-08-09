from __future__ import annotations

from fastapi import APIRouter

from orbis_user_api.api import members, notes, ownership, setup
from orbis_user_api.api.v1 import (
    auth,
    document_groups,
    files,
    notebooks,
    users,
)

api_router = APIRouter()
api_router.include_router(setup.router)
api_router.include_router(members.router)
api_router.include_router(ownership.router)
api_router.include_router(notes.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(document_groups.router)
api_router.include_router(notebooks.router)
api_router.include_router(files.router)
