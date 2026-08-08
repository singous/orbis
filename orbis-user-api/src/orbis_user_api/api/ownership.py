from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.errors import ApiError

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

router = ApiRouter(prefix="/workspace/ownership-transfers", tags=["ownership"])


@router.get("/current", response_model=OwnershipTransferOut)
async def current_transfer(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await get_current_ownership_transfer(user, session)
    except OwnershipTransferNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="OWNERSHIP_TRANSFER_NOT_FOUND",
            message="当前没有待处理的所有权转让",
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="OWNERSHIP_TRANSFER_FORBIDDEN",
            message="无权执行所有权转让操作",
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
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="MAIL_SERVICE_UNAVAILABLE",
            message="邮件服务暂不可用",
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="OWNERSHIP_TRANSFER_FORBIDDEN",
            message="无权执行所有权转让操作",
        ) from None
    except OwnershipTransferAlreadyPending:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_ALREADY_PENDING",
            message="已有待处理的所有权转让",
        ) from None
    except OwnershipTransferInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_INVALID",
            message="当前所有权转让无法创建",
        ) from None


@router.delete("/{transfer_id}", status_code=status.HTTP_200_OK)
async def cancel_transfer(
    transfer_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await cancel_ownership_transfer(transfer_id, user, session)
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="OWNERSHIP_TRANSFER_FORBIDDEN",
            message="无权执行所有权转让操作",
        ) from None
    except OwnershipTransferInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_INVALID",
            message="当前所有权转让无法取消",
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
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="MAIL_SERVICE_UNAVAILABLE",
            message="邮件服务暂不可用",
        ) from None
    except OwnershipTransferExpired:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_EXPIRED",
            message="所有权转让已过期",
        ) from None
    except (OwnershipTransferForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="OWNERSHIP_TRANSFER_FORBIDDEN",
            message="无权执行所有权转让操作",
        ) from None
    except OwnershipTransferInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_INVALID",
            message="当前所有权转让无法重新发送",
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
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_EXPIRED",
            message="所有权转让已过期",
        ) from None
    except OwnershipTransferInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="OWNERSHIP_TRANSFER_INVALID",
            message="所有权转让无效",
        ) from None
