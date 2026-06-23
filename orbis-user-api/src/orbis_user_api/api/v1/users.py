from __future__ import annotations

from fastapi import APIRouter, Depends

from orbis_user_api.api.deps import get_current_user
from orbis_user_api.models.user import User
from orbis_user_api.schemas.user import UserOut

router = APIRouter(prefix="/v1/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def current_user(user: User = Depends(get_current_user)) -> User:
    return user
