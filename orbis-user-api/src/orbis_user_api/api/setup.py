from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_session
from orbis_user_api.schemas.setup import SetupRequest, SetupResponse
from orbis_user_api.services.exceptions import SystemAlreadyInitialized
from orbis_user_api.services.setup import setup_community

router = APIRouter(tags=["setup"])


@router.post("/setup", response_model=SetupResponse, status_code=status.HTTP_201_CREATED)
async def setup(
    payload: SetupRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> SetupResponse:
    try:
        access_token, refresh_token, user, workspace = await setup_community(
            payload,
            request.app.state.settings,
            session,
        )
    except SystemAlreadyInitialized:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="System is already initialized",
        ) from None

    return SetupResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
        workspace=workspace,
    )
