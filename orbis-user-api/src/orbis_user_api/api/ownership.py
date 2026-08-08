from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.models.user import User
from orbis_user_api.schemas.ownership import (
    OwnershipTransferConfirmRequest,
    OwnershipTransferCreateRequest,
    OwnershipTransferOut,
)
from orbis_user_api.services.exceptions import (
    MailServiceUnavailable,
    OwnershipTransferAlreadyPending,
    OwnershipTransferExpired,
    OwnershipTransferForbidden,
    OwnershipTransferInvalid,
    OwnershipTransferNotFound,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)
from orbis_user_api.services.ownership import (
    cancel_ownership_transfer,
    confirm_ownership_transfer,
    create_ownership_transfer,
    get_current_ownership_transfer,
    resend_ownership_transfer,
)

router = APIRouter(prefix="/workspace/ownership-transfers", tags=["ownership"])


@router.get("/current", response_model=OwnershipTransferOut)
async def current_transfer(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await get_current_ownership_transfer(user, session)
    except OwnershipTransferNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending ownership transfer",
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Ownership transfer forbidden"
        ) from None


@router.post(
    "", response_model=OwnershipTransferOut, status_code=status.HTTP_201_CREATED
)
async def start_ownership_transfer(
    payload: OwnershipTransferCreateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await create_ownership_transfer(
            payload.target_member_id,
            user,
            request.app.state.settings,
            request.app.state.mail_sender,
            session,
        )
    except MailServiceUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail service is unavailable",
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Ownership transfer forbidden"
        ) from None
    except OwnershipTransferAlreadyPending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An ownership transfer is already pending",
        ) from None
    except OwnershipTransferInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ownership transfer cannot be created",
        ) from None


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_transfer(
    transfer_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await cancel_ownership_transfer(transfer_id, user, session)
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Ownership transfer forbidden"
        ) from None
    except OwnershipTransferInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ownership transfer cannot be cancelled",
        ) from None


@router.post("/{transfer_id}/resend", response_model=OwnershipTransferOut)
async def resend_transfer(
    transfer_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await resend_ownership_transfer(
            transfer_id,
            user,
            request.app.state.settings,
            request.app.state.mail_sender,
            session,
        )
    except MailServiceUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail service is unavailable",
        ) from None
    except OwnershipTransferExpired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="Ownership transfer has expired"
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Ownership transfer forbidden"
        ) from None
    except OwnershipTransferInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ownership transfer cannot be resent",
        ) from None


@router.post("/confirm", response_model=OwnershipTransferOut)
async def confirm_transfer(
    payload: OwnershipTransferConfirmRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await confirm_ownership_transfer(
            payload.token, request.app.state.settings, session
        )
    except OwnershipTransferExpired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="Ownership transfer has expired"
        ) from None
    except OwnershipTransferInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Ownership transfer is invalid"
        ) from None
