from __future__ import annotations

from fastapi import APIRouter

from orbis_user_api.api.v1 import auth, document_groups, documents, files, notebooks, users, workspaces

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(workspaces.router)
api_router.include_router(document_groups.router)
api_router.include_router(notebooks.router)
api_router.include_router(documents.router)
api_router.include_router(files.router)
