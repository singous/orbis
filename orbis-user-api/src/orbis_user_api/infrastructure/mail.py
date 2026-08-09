from __future__ import annotations

import asyncio
import json
import smtplib
from dataclasses import asdict, dataclass
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms


class MailDeliveryError(Exception):
    """Raised when a configured mail transport cannot deliver a message."""


@dataclass(frozen=True, slots=True)
class WorkspaceInvitationMail:
    recipient: str
    token: str
    role: str
    expires_at_ms: int
    accept_url: str
    message_type: str = "workspace_invitation"


@dataclass(frozen=True, slots=True)
class OwnershipTransferMail:
    recipient: str
    token: str
    target_display_name: str
    expires_at_ms: int
    confirm_url: str
    message_type: str = "ownership_transfer_confirmation"


class MailSender(Protocol):
    @property
    def available(self) -> bool: ...

    async def send_workspace_invitation(
        self, message: WorkspaceInvitationMail
    ) -> None: ...

    async def send_ownership_transfer(self, message: OwnershipTransferMail) -> None: ...


class DisabledMailSender:
    @property
    def available(self) -> bool:
        return False

    async def send_workspace_invitation(self, message: WorkspaceInvitationMail) -> None:
        del message
        raise MailDeliveryError("Mail service is not configured")

    async def send_ownership_transfer(self, message: OwnershipTransferMail) -> None:
        del message
        raise MailDeliveryError("Mail service is not configured")


class OutboxMailSender:
    def __init__(self, outbox_dir: Path) -> None:
        self._outbox_dir = outbox_dir

    @property
    def available(self) -> bool:
        return True

    async def send_workspace_invitation(self, message: WorkspaceInvitationMail) -> None:
        self._write_message(message)

    async def send_ownership_transfer(self, message: OwnershipTransferMail) -> None:
        self._write_message(message)

    def _write_message(
        self, message: WorkspaceInvitationMail | OwnershipTransferMail
    ) -> None:
        self._outbox_dir.mkdir(parents=True, exist_ok=True)
        path = self._outbox_dir / f"{now_ms()}-{new_uuidv7()}.json"
        path.write_text(
            json.dumps(asdict(message), ensure_ascii=False), encoding="utf-8"
        )


class SmtpMailSender:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def available(self) -> bool:
        return bool(self._settings.smtp_host)

    async def send_workspace_invitation(self, message: WorkspaceInvitationMail) -> None:
        if not self.available:
            raise MailDeliveryError("SMTP host is not configured")
        try:
            await asyncio.to_thread(self._send, message)
        except (OSError, smtplib.SMTPException) as exc:
            raise MailDeliveryError(str(exc)) from exc

    async def send_ownership_transfer(self, message: OwnershipTransferMail) -> None:
        if not self.available:
            raise MailDeliveryError("SMTP host is not configured")
        try:
            await asyncio.to_thread(self._send_ownership_transfer, message)
        except (OSError, smtplib.SMTPException) as exc:
            raise MailDeliveryError(str(exc)) from exc

    def _send(self, invitation: WorkspaceInvitationMail) -> None:
        settings = self._settings
        message = EmailMessage()
        message["Subject"] = "Join your Orbis workspace"
        message["From"] = settings.mail_sender
        message["To"] = invitation.recipient
        message.set_content(
            "You have been invited to Orbis as "
            f"{invitation.role}. Accept the invitation: {invitation.accept_url}"
        )

        self._deliver(message)

    def _send_ownership_transfer(self, transfer: OwnershipTransferMail) -> None:
        settings = self._settings
        message = EmailMessage()
        message["Subject"] = "Confirm Orbis ownership transfer"
        message["From"] = settings.mail_sender
        message["To"] = transfer.recipient
        message.set_content(
            "Confirm transferring Orbis ownership to "
            f"{transfer.target_display_name}: {transfer.confirm_url}"
        )
        self._deliver(message)

    def _deliver(self, message: EmailMessage) -> None:
        settings = self._settings
        if settings.smtp_security == "ssl":
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as client:
                self._authenticate_and_send(client, message)
            return

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as client:
            if settings.smtp_security == "starttls":
                client.starttls()
            self._authenticate_and_send(client, message)

    def _authenticate_and_send(
        self, client: smtplib.SMTP, message: EmailMessage
    ) -> None:
        settings = self._settings
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password or "")
        client.send_message(message)


def create_mail_sender(settings: Settings) -> MailSender:
    if settings.mail_transport == "outbox":
        return OutboxMailSender(settings.mail_outbox_dir)
    if settings.mail_transport == "smtp":
        return SmtpMailSender(settings)
    return DisabledMailSender()
