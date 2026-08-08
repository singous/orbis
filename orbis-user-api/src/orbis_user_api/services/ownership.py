from __future__ import annotations

import logging
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import hash_action_token, new_action_token
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.infrastructure.mail import (
    MailDeliveryError,
    MailSender,
    OwnershipTransferMail,
)
from orbis_user_api.models.community import CommunityState
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import (
    OwnershipTransfer,
    Workspace,
    WorkspaceMember,
)
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import (
    MailServiceUnavailable,
    OwnershipTransferAlreadyPending,
    OwnershipTransferExpired,
    OwnershipTransferInvalid,
    OwnershipTransferNotFound,
)

logger = logging.getLogger(__name__)


def ownership_transfer_payload(transfer: OwnershipTransfer) -> dict[str, object]:
    return {
        "id": transfer.id,
        "from_user_id": transfer.from_user_id,
        "target_member_id": transfer.target_member_id,
        "target_user_id": transfer.target_user_id,
        "status": transfer.status,
        "expires_at_ms": transfer.expires_at_ms,
        "email_sent": transfer.email_sent,
        "email_error_summary": transfer.email_error_summary,
        "confirmed_at_ms": transfer.confirmed_at_ms,
        "cancelled_at_ms": transfer.cancelled_at_ms,
        "created_at_ms": transfer.created_at_ms,
        "updated_at_ms": transfer.updated_at_ms,
    }


def _delivery_error_summary(error: MailDeliveryError) -> str:
    summary = str(error).strip() or "Mail delivery failed"
    return summary[:240]


async def get_current_ownership_transfer(
    actor_user: User,
    session: AsyncSession,
) -> dict[str, object]:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(
        actor_membership, Capability.OWNERSHIP_TRANSFER
    )
    result = await session.execute(
        select(OwnershipTransfer)
        .where(
            OwnershipTransfer.workspace_id == workspace.id,
            OwnershipTransfer.from_user_id == actor_user.id,
            OwnershipTransfer.status == "pending",
        )
        .order_by(OwnershipTransfer.created_at_ms.desc())
    )
    transfer = result.scalars().first()
    if transfer is None:
        raise OwnershipTransferNotFound
    if transfer.expires_at_ms <= now_ms():
        transfer.status = "expired"
        transfer.updated_at_ms = now_ms()
        await session.commit()
        raise OwnershipTransferNotFound
    return ownership_transfer_payload(transfer)


async def create_ownership_transfer(
    target_member_id: UUID,
    actor_user: User,
    settings: Settings,
    mail_sender: MailSender,
    session: AsyncSession,
) -> dict[str, object]:
    if not mail_sender.available:
        raise MailServiceUnavailable

    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(
        actor_membership, Capability.OWNERSHIP_TRANSFER
    )
    timestamp = now_ms()
    pending_result = await session.execute(
        select(OwnershipTransfer).where(
            OwnershipTransfer.workspace_id == workspace.id,
            OwnershipTransfer.status == "pending",
        )
    )
    pending = pending_result.scalars().first()
    if pending is not None:
        if pending.expires_at_ms > timestamp:
            raise OwnershipTransferAlreadyPending
        pending.status = "expired"
        pending.updated_at_ms = timestamp
        await session.commit()

    target_result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.id == target_member_id,
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == "active",
            User.status == "active",
        )
    )
    target_row = target_result.first()
    if target_row is None:
        raise OwnershipTransferInvalid
    target_membership, target_user = target_row
    if target_membership.role != "admin":
        raise OwnershipTransferInvalid

    token = new_action_token()
    transfer = OwnershipTransfer(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        from_user_id=actor_user.id,
        target_member_id=target_membership.id,
        target_user_id=target_user.id,
        token_hash=hash_action_token(token, settings),
        expires_at_ms=timestamp + settings.ownership_transfer_ttl_seconds * 1000,
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add(transfer)
    await session.commit()
    await session.refresh(transfer)

    query = urlencode({"token": token})
    message = OwnershipTransferMail(
        recipient=actor_user.email,
        token=token,
        target_display_name=target_user.display_name or target_user.email,
        expires_at_ms=transfer.expires_at_ms,
        confirm_url=f"{settings.user_web_base_url.rstrip('/')}/ownership-transfers/confirm?{query}",
    )
    try:
        await mail_sender.send_ownership_transfer(message)
    except MailDeliveryError as error:
        transfer.email_sent = False
        transfer.email_error_summary = _delivery_error_summary(error)
        logger.warning(
            "Ownership transfer email delivery failed",
            extra={"transfer_id": str(transfer.id)},
        )
    else:
        transfer.email_sent = True
        transfer.email_error_summary = None
        logger.info(
            "Ownership transfer email sent", extra={"transfer_id": str(transfer.id)}
        )
    transfer.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(transfer)
    return ownership_transfer_payload(transfer)


async def confirm_ownership_transfer(
    token: str,
    settings: Settings,
    session: AsyncSession,
) -> dict[str, object]:
    result = await session.execute(
        select(OwnershipTransfer).where(
            OwnershipTransfer.token_hash == hash_action_token(token, settings),
            OwnershipTransfer.status == "pending",
        )
    )
    transfer = result.scalar_one_or_none()
    if transfer is None:
        raise OwnershipTransferInvalid

    timestamp = now_ms()
    if transfer.expires_at_ms <= timestamp:
        transfer.status = "expired"
        transfer.updated_at_ms = timestamp
        await session.commit()
        raise OwnershipTransferExpired

    workspace = await session.get(Workspace, transfer.workspace_id)
    state_result = await session.execute(select(CommunityState).limit(1))
    state = state_result.scalar_one_or_none()
    old_member_result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == transfer.workspace_id,
            WorkspaceMember.user_id == transfer.from_user_id,
        )
    )
    old_membership = old_member_result.scalar_one_or_none()
    target_membership = await session.get(WorkspaceMember, transfer.target_member_id)
    old_user = await session.get(User, transfer.from_user_id)
    target_user = await session.get(User, transfer.target_user_id)
    is_valid = (
        workspace is not None
        and workspace.status == "active"
        and workspace.owner_id == transfer.from_user_id
        and state is not None
        and state.owner_user_id == transfer.from_user_id
        and old_user is not None
        and old_user.status == "active"
        and old_membership is not None
        and old_membership.status == "active"
        and old_membership.role == "owner"
        and target_user is not None
        and target_user.status == "active"
        and target_membership is not None
        and target_membership.workspace_id == transfer.workspace_id
        and target_membership.user_id == transfer.target_user_id
        and target_membership.status == "active"
        and target_membership.role == "admin"
    )
    if not is_valid:
        transfer.status = "failed"
        transfer.updated_at_ms = timestamp
        await session.commit()
        raise OwnershipTransferInvalid

    assert workspace is not None
    assert state is not None
    assert old_membership is not None
    assert target_membership is not None
    old_membership.role = "admin"
    old_membership.updated_at_ms = timestamp
    target_membership.role = "owner"
    target_membership.updated_at_ms = timestamp
    workspace.owner_id = transfer.target_user_id
    workspace.updated_at_ms = timestamp
    state.owner_user_id = transfer.target_user_id
    state.updated_at_ms = timestamp
    transfer.status = "confirmed"
    transfer.confirmed_at_ms = timestamp
    transfer.updated_at_ms = timestamp
    await session.commit()
    await session.refresh(transfer)
    logger.info("Ownership transfer confirmed", extra={"transfer_id": str(transfer.id)})
    return ownership_transfer_payload(transfer)


async def cancel_ownership_transfer(
    transfer_id: UUID,
    actor_user: User,
    session: AsyncSession,
) -> None:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(
        actor_membership, Capability.OWNERSHIP_TRANSFER
    )
    result = await session.execute(
        select(OwnershipTransfer).where(
            OwnershipTransfer.id == transfer_id,
            OwnershipTransfer.workspace_id == workspace.id,
            OwnershipTransfer.from_user_id == actor_user.id,
            OwnershipTransfer.status == "pending",
        )
    )
    transfer = result.scalar_one_or_none()
    if transfer is None:
        raise OwnershipTransferInvalid

    timestamp = now_ms()
    if transfer.expires_at_ms <= timestamp:
        transfer.status = "expired"
        transfer.updated_at_ms = timestamp
        await session.commit()
        raise OwnershipTransferInvalid

    transfer.status = "cancelled"
    transfer.cancelled_at_ms = timestamp
    transfer.updated_at_ms = timestamp
    await session.commit()
    logger.info("Ownership transfer cancelled", extra={"transfer_id": str(transfer.id)})


async def resend_ownership_transfer(
    transfer_id: UUID,
    actor_user: User,
    settings: Settings,
    mail_sender: MailSender,
    session: AsyncSession,
) -> dict[str, object]:
    if not mail_sender.available:
        raise MailServiceUnavailable

    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(
        actor_membership, Capability.OWNERSHIP_TRANSFER
    )
    result = await session.execute(
        select(OwnershipTransfer).where(
            OwnershipTransfer.id == transfer_id,
            OwnershipTransfer.workspace_id == workspace.id,
            OwnershipTransfer.from_user_id == actor_user.id,
            OwnershipTransfer.status == "pending",
        )
    )
    transfer = result.scalar_one_or_none()
    if transfer is None:
        raise OwnershipTransferInvalid

    timestamp = now_ms()
    if transfer.expires_at_ms <= timestamp:
        transfer.status = "expired"
        transfer.updated_at_ms = timestamp
        await session.commit()
        raise OwnershipTransferExpired

    target_user = await session.get(User, transfer.target_user_id)
    if target_user is None:
        raise OwnershipTransferInvalid

    token = new_action_token()
    transfer.token_hash = hash_action_token(token, settings)
    transfer.expires_at_ms = timestamp + settings.ownership_transfer_ttl_seconds * 1000
    transfer.email_sent = False
    transfer.email_error_summary = None
    transfer.updated_at_ms = timestamp
    await session.commit()

    query = urlencode({"token": token})
    message = OwnershipTransferMail(
        recipient=actor_user.email,
        token=token,
        target_display_name=target_user.display_name or target_user.email,
        expires_at_ms=transfer.expires_at_ms,
        confirm_url=f"{settings.user_web_base_url.rstrip('/')}/ownership-transfers/confirm?{query}",
    )
    try:
        await mail_sender.send_ownership_transfer(message)
    except MailDeliveryError as error:
        transfer.email_sent = False
        transfer.email_error_summary = _delivery_error_summary(error)
        logger.warning(
            "Ownership transfer email resend failed",
            extra={"transfer_id": str(transfer.id)},
        )
    else:
        transfer.email_sent = True
        transfer.email_error_summary = None
        logger.info(
            "Ownership transfer email resent", extra={"transfer_id": str(transfer.id)}
        )
    transfer.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(transfer)
    return ownership_transfer_payload(transfer)
