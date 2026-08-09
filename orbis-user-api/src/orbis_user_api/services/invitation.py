from __future__ import annotations

import logging
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import (
    create_access_token,
    hash_action_token,
    hash_password,
    new_action_token,
)
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.infrastructure.mail import (
    MailDeliveryError,
    MailSender,
    WorkspaceInvitationMail,
)
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import WorkspaceInvitation, WorkspaceMember
from orbis_user_api.schemas.member import (
    InvitationAcceptRequest,
    InvitationCreateRequest,
)
from orbis_user_api.services.auth import create_refresh_session, normalize_email
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import (
    InvitationAccountExists,
    InvitationExpired,
    InvitationForbidden,
    InvitationInvalid,
    InvitationPasswordRequired,
    MailServiceUnavailable,
)

logger = logging.getLogger(__name__)


def invitation_payload(invitation: WorkspaceInvitation) -> dict[str, object]:
    return {
        "id": invitation.id,
        "email": invitation.email,
        "role": invitation.role,
        "status": invitation.status,
        "expires_at_ms": invitation.expires_at_ms,
        "email_sent": invitation.email_sent,
        "email_error_summary": invitation.email_error_summary,
        "created_at_ms": invitation.created_at_ms,
        "updated_at_ms": invitation.updated_at_ms,
    }


def _delivery_error_summary(error: MailDeliveryError) -> str:
    summary = str(error).strip() or "Mail delivery failed"
    return summary[:240]


async def list_invitations(
    actor_user: User,
    session: AsyncSession,
    *,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[dict[str, object]], int]:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)
    conditions = (WorkspaceInvitation.workspace_id == workspace.id,)
    total = await session.scalar(
        select(func.count(WorkspaceInvitation.id)).where(*conditions)
    )
    result = await session.execute(
        select(WorkspaceInvitation)
        .where(*conditions)
        .order_by(WorkspaceInvitation.created_at_ms.desc())
        .offset(offset)
        .limit(limit)
    )
    return (
        [invitation_payload(invitation) for invitation in result.scalars()],
        int(total or 0),
    )


async def create_invitation(
    payload: InvitationCreateRequest,
    actor_user: User,
    settings: Settings,
    mail_sender: MailSender,
    session: AsyncSession,
) -> dict[str, object]:
    if not mail_sender.available:
        raise MailServiceUnavailable

    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)
    if actor_membership.role == "admin" and payload.role == "admin":
        raise InvitationForbidden
    ttl_seconds = payload.expires_in_seconds or settings.invitation_default_ttl_seconds
    if ttl_seconds > settings.invitation_max_ttl_seconds:
        raise InvitationInvalid

    email = normalize_email(str(payload.email))
    timestamp = now_ms()
    existing_member_result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.status == "active",
            User.email == email,
        )
    )
    if existing_member_result.first() is not None:
        raise InvitationInvalid

    pending_result = await session.execute(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace.id,
            WorkspaceInvitation.email == email,
            WorkspaceInvitation.status == "pending",
        )
    )
    for pending in pending_result.scalars():
        pending.status = "revoked"
        pending.revoked_at_ms = timestamp
        pending.updated_at_ms = timestamp

    token = new_action_token()
    invitation = WorkspaceInvitation(
        tenant_id=workspace.tenant_id,
        workspace_id=workspace.id,
        email=email,
        role=payload.role,
        token_hash=hash_action_token(token, settings),
        expires_at_ms=timestamp + ttl_seconds * 1000,
        ttl_seconds=ttl_seconds,
        invited_by_user_id=actor_user.id,
        created_at_ms=timestamp,
        updated_at_ms=timestamp,
    )
    session.add(invitation)
    await session.commit()
    await session.refresh(invitation)

    query = urlencode({"token": token})
    message = WorkspaceInvitationMail(
        recipient=email,
        token=token,
        role=payload.role,
        expires_at_ms=invitation.expires_at_ms,
        accept_url=f"{settings.user_web_base_url.rstrip('/')}/invitations/accept?{query}",
    )
    try:
        await mail_sender.send_workspace_invitation(message)
    except MailDeliveryError as error:
        invitation.email_sent = False
        invitation.email_error_summary = _delivery_error_summary(error)
        logger.warning(
            "Workspace invitation email delivery failed",
            extra={"invitation_id": str(invitation.id)},
        )
    else:
        invitation.email_sent = True
        invitation.email_error_summary = None
        logger.info(
            "Workspace invitation email sent",
            extra={"invitation_id": str(invitation.id)},
        )
    invitation.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(invitation)
    return invitation_payload(invitation)


async def accept_invitation(
    payload: InvitationAcceptRequest,
    current_user: User | None,
    settings: Settings,
    session: AsyncSession,
) -> tuple[User, WorkspaceMember, str | None, str | None]:
    timestamp = now_ms()
    result = await session.execute(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.token_hash
            == hash_action_token(payload.token, settings),
            WorkspaceInvitation.status == "pending",
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise InvitationInvalid
    if invitation.expires_at_ms <= timestamp:
        invitation.status = "expired"
        invitation.updated_at_ms = timestamp
        await session.commit()
        raise InvitationExpired
    user_result = await session.execute(
        select(User).where(User.email == invitation.email)
    )
    user = user_result.scalar_one_or_none()
    new_account = user is None
    if user is not None:
        if current_user is None or current_user.id != user.id:
            raise InvitationAccountExists
        if user.status != "active":
            raise InvitationForbidden
    else:
        if payload.password is None or payload.display_name is None:
            raise InvitationPasswordRequired
        user = User(
            tenant_id=invitation.tenant_id,
            email=invitation.email,
            password_hash=hash_password(payload.password),
            display_name=payload.display_name.strip(),
            current_workspace_id=invitation.workspace_id,
            status="active",
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
        session.add(user)
        await session.flush()

    member_result = await session.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == invitation.workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    membership = member_result.scalar_one_or_none()
    if membership is None:
        membership = WorkspaceMember(
            tenant_id=invitation.tenant_id,
            workspace_id=invitation.workspace_id,
            user_id=user.id,
            role=invitation.role,
            status="active",
            created_at_ms=timestamp,
            updated_at_ms=timestamp,
        )
        session.add(membership)
    elif membership.status == "active":
        invitation.status = "accepted"
        invitation.accepted_by_user_id = user.id
        invitation.accepted_at_ms = timestamp
        invitation.updated_at_ms = timestamp
        await session.commit()
        raise InvitationInvalid
    else:
        membership.role = invitation.role
        membership.status = "active"
        membership.updated_at_ms = timestamp

    user.current_workspace_id = invitation.workspace_id
    user.updated_at_ms = timestamp
    invitation.status = "accepted"
    invitation.accepted_by_user_id = user.id
    invitation.accepted_at_ms = timestamp
    invitation.updated_at_ms = timestamp

    access_token: str | None = None
    refresh_token: str | None = None
    if new_account:
        refresh_token = await create_refresh_session(user, settings, session)
        access_token = create_access_token(user.id, settings)

    await session.commit()
    await session.refresh(user)
    await session.refresh(membership)
    logger.info(
        "Workspace invitation accepted",
        extra={"invitation_id": str(invitation.id), "member_id": str(membership.id)},
    )
    return user, membership, access_token, refresh_token


async def revoke_invitation(
    invitation_id: UUID,
    actor_user: User,
    session: AsyncSession,
) -> None:
    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)
    result = await session.execute(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.id == invitation_id,
            WorkspaceInvitation.workspace_id == workspace.id,
            WorkspaceInvitation.status == "pending",
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise InvitationInvalid

    timestamp = now_ms()
    if invitation.expires_at_ms <= timestamp:
        invitation.status = "expired"
        invitation.updated_at_ms = timestamp
        await session.commit()
        raise InvitationInvalid

    invitation.status = "revoked"
    invitation.revoked_at_ms = timestamp
    invitation.updated_at_ms = timestamp
    await session.commit()
    logger.info(
        "Workspace invitation revoked", extra={"invitation_id": str(invitation.id)}
    )


async def resend_invitation(
    invitation_id: UUID,
    actor_user: User,
    settings: Settings,
    mail_sender: MailSender,
    session: AsyncSession,
) -> dict[str, object]:
    if not mail_sender.available:
        raise MailServiceUnavailable

    workspace, actor_membership = await AuthorizationService.actor(actor_user, session)
    AuthorizationService.require_capability(actor_membership, Capability.MEMBER_MANAGE)
    result = await session.execute(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.id == invitation_id,
            WorkspaceInvitation.workspace_id == workspace.id,
            WorkspaceInvitation.status == "pending",
        )
    )
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise InvitationInvalid

    timestamp = now_ms()
    if invitation.expires_at_ms <= timestamp:
        invitation.status = "expired"
        invitation.updated_at_ms = timestamp
        await session.commit()
        raise InvitationExpired

    token = new_action_token()
    invitation.token_hash = hash_action_token(token, settings)
    invitation.expires_at_ms = timestamp + invitation.ttl_seconds * 1000
    invitation.email_sent = False
    invitation.email_error_summary = None
    invitation.updated_at_ms = timestamp
    await session.commit()

    query = urlencode({"token": token})
    message = WorkspaceInvitationMail(
        recipient=invitation.email,
        token=token,
        role=invitation.role,
        expires_at_ms=invitation.expires_at_ms,
        accept_url=f"{settings.user_web_base_url.rstrip('/')}/invitations/accept?{query}",
    )
    try:
        await mail_sender.send_workspace_invitation(message)
    except MailDeliveryError as error:
        invitation.email_sent = False
        invitation.email_error_summary = _delivery_error_summary(error)
        logger.warning(
            "Workspace invitation resend failed",
            extra={"invitation_id": str(invitation.id)},
        )
    else:
        invitation.email_sent = True
        invitation.email_error_summary = None
        logger.info(
            "Workspace invitation resent", extra={"invitation_id": str(invitation.id)}
        )
    invitation.updated_at_ms = now_ms()
    await session.commit()
    await session.refresh(invitation)
    return invitation_payload(invitation)
