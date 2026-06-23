from __future__ import annotations

from fastapi import APIRouter

from orbis_user_api.api.v1 import auth, files, notes, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(notes.router)
api_router.include_router(files.router)
