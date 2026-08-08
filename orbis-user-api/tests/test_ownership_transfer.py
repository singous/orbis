from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from orbis_user_api.infrastructure.mail import (
    DisabledMailSender,
    MailDeliveryError,
    OutboxMailSender,
)

PASSWORD = "correct horse battery staple"


class FailingOwnershipMailSender:
    @property
    def available(self) -> bool:
        return True

    async def send_ownership_transfer(self, message: object) -> None:
        del message
        raise MailDeliveryError("SMTP connection timed out")


@pytest.fixture()
def outbox_dir(tmp_path: Path) -> Path:
    return tmp_path / "mail-outbox"


@pytest.fixture()
def client(
    tmp_path: Path,
    outbox_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv("ORBIS_MAIL_TRANSPORT", "outbox")
    monkeypatch.setenv("ORBIS_MAIL_OUTBOX_DIR", str(outbox_dir))

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def setup_owner(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201
    return response.json()["data"]


def latest_outbox_message(
    outbox_dir: Path, recipient: str, message_type: str
) -> dict[str, Any]:
    messages = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(outbox_dir.glob("*.json"))
    ]
    matching = [
        message
        for message in messages
        if message["recipient"] == recipient and message["message_type"] == message_type
    ]
    assert matching, f"No {message_type} message found for {recipient}"
    return matching[-1]


def invite_admin(
    client: TestClient, outbox_dir: Path, owner_token: str
) -> dict[str, Any]:
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner_token),
        json={"email": "admin@example.com", "role": "admin"},
    )
    assert invitation_response.status_code == 201
    message = latest_outbox_message(
        outbox_dir, "admin@example.com", "workspace_invitation"
    )
    accepted_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": "Admin",
        },
    )
    assert accepted_response.status_code == 201
    return accepted_response.json()["data"]


def invite_member(
    client: TestClient,
    outbox_dir: Path,
    owner_token: str,
    *,
    email: str,
    role: str,
) -> dict[str, Any]:
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner_token),
        json={"email": email, "role": role},
    )
    assert invitation_response.status_code == 201
    message = latest_outbox_message(outbox_dir, email, "workspace_invitation")
    accepted_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": role.title(),
        },
    )
    assert accepted_response.status_code == 201
    return accepted_response.json()["data"]


def test_owner_confirms_transfer_to_active_admin_from_email_token(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])

    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )

    assert create_response.status_code == 201
    transfer = create_response.json()["data"]
    assert transfer["status"] == "pending"
    assert transfer["email_sent"] is True
    assert transfer["expires_at_ms"] - transfer["created_at_ms"] == 15 * 60 * 1000
    assert "token" not in transfer
    assert "confirm_url" not in transfer
    message = latest_outbox_message(
        outbox_dir,
        "owner@example.com",
        "ownership_transfer_confirmation",
    )

    confirm_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )

    assert confirm_response.status_code == 200
    assert confirm_response.json()["data"]["status"] == "confirmed"
    repeated_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )
    assert repeated_response.status_code == 409

    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    roles = {item["email"]: item["role"] for item in members_response.json()["data"]["items"]}
    assert roles == {"owner@example.com": "admin", "admin@example.com": "owner"}


def test_owner_cannot_transfer_ownership_to_non_admin(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    editor = invite_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="editor@example.com",
        role="editor",
    )

    response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": editor["membership"]["id"]},
    )

    assert response.status_code == 409


def test_admin_cannot_start_ownership_transfer(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    first_admin = invite_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="first-admin@example.com",
        role="admin",
    )
    second_admin = invite_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="second-admin@example.com",
        role="admin",
    )

    response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(first_admin["access_token"]),
        json={"target_member_id": second_admin["membership"]["id"]},
    )

    assert response.status_code == 403


def test_only_one_pending_ownership_transfer_can_exist(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    first_admin = invite_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="first-admin@example.com",
        role="admin",
    )
    second_admin = invite_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="second-admin@example.com",
        role="admin",
    )
    first_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": first_admin["membership"]["id"]},
    )

    second_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": second_admin["membership"]["id"]},
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 409


def test_owner_cancels_pending_transfer_and_can_start_another(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])
    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    transfer = create_response.json()["data"]
    message = latest_outbox_message(
        outbox_dir,
        "owner@example.com",
        "ownership_transfer_confirmation",
    )

    cancel_response = client.delete(
        f"/workspace/ownership-transfers/{transfer['id']}",
        headers=auth_header(owner["access_token"]),
    )

    assert cancel_response.status_code == 200
    assert cancel_response.json()["data"] is None
    confirm_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )
    assert confirm_response.status_code == 409
    second_create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    assert second_create_response.status_code == 201


def test_expired_ownership_transfer_cannot_be_confirmed(
    client: TestClient,
    outbox_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])
    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    transfer = create_response.json()["data"]
    message = latest_outbox_message(
        outbox_dir,
        "owner@example.com",
        "ownership_transfer_confirmation",
    )
    monkeypatch.setattr(
        "orbis_user_api.services.ownership.now_ms",
        lambda: transfer["expires_at_ms"] + 1,
    )

    first_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )
    second_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )

    assert first_response.status_code == 409
    assert first_response.json()["code"] == "OWNERSHIP_TRANSFER_EXPIRED"
    assert second_response.status_code == 409


def test_confirmation_revalidates_target_is_still_active_admin(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])
    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    assert create_response.status_code == 201
    message = latest_outbox_message(
        outbox_dir,
        "owner@example.com",
        "ownership_transfer_confirmation",
    )
    assert (
        client.patch(
            f"/workspace/members/{admin['membership']['id']}",
            headers=auth_header(owner["access_token"]),
            json={"role": "normal"},
        ).status_code
        == 200
    )

    confirm_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )

    assert confirm_response.status_code == 409
    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    roles = {item["email"]: item["role"] for item in members_response.json()["data"]["items"]}
    assert roles == {"owner@example.com": "owner", "admin@example.com": "normal"}


def test_ownership_transfer_is_unavailable_when_mail_is_not_configured(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])
    client.app.state.mail_sender = DisabledMailSender()

    response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )

    assert response.status_code == 503


def test_failed_ownership_email_can_be_resent_with_new_expiry(
    client: TestClient,
    outbox_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = setup_owner(client)
    admin = invite_admin(client, outbox_dir, owner["access_token"])
    client.app.state.mail_sender = FailingOwnershipMailSender()
    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    assert create_response.status_code == 201
    transfer = create_response.json()["data"]
    assert transfer["status"] == "pending"
    assert transfer["email_sent"] is False
    assert transfer["email_error_summary"] == "SMTP connection timed out"

    monkeypatch.setattr(
        "orbis_user_api.services.ownership.now_ms",
        lambda: transfer["created_at_ms"] + 30_000,
    )
    client.app.state.mail_sender = OutboxMailSender(outbox_dir)
    resend_response = client.post(
        f"/workspace/ownership-transfers/{transfer['id']}/resend",
        headers=auth_header(owner["access_token"]),
    )

    assert resend_response.status_code == 200
    resent = resend_response.json()["data"]
    assert resent["email_sent"] is True
    assert resent["email_error_summary"] is None
    assert (
        resent["expires_at_ms"] == transfer["created_at_ms"] + 30_000 + 15 * 60 * 1000
    )
    message = latest_outbox_message(
        outbox_dir,
        "owner@example.com",
        "ownership_transfer_confirmation",
    )
    confirm_response = client.post(
        "/workspace/ownership-transfers/confirm",
        json={"token": message["token"]},
    )
    assert confirm_response.status_code == 200


def test_owner_reads_current_pending_transfer_without_token(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    missing_response = client.get(
        "/workspace/ownership-transfers/current",
        headers=auth_header(owner["access_token"]),
    )
    assert missing_response.status_code == 404

    admin = invite_admin(client, outbox_dir, owner["access_token"])
    create_response = client.post(
        "/workspace/ownership-transfers",
        headers=auth_header(owner["access_token"]),
        json={"target_member_id": admin["membership"]["id"]},
    )
    assert create_response.status_code == 201

    current_response = client.get(
        "/workspace/ownership-transfers/current",
        headers=auth_header(owner["access_token"]),
    )

    assert current_response.status_code == 200
    current = current_response.json()["data"]
    assert current["id"] == create_response.json()["data"]["id"]
    assert current["status"] == "pending"
    assert "token" not in current
    assert "confirm_url" not in current
