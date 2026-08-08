from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from orbis_user_api.infrastructure.mail import MailDeliveryError

PASSWORD = "correct horse battery staple"


class FailingMailSender:
    @property
    def available(self) -> bool:
        return True

    async def send_workspace_invitation(self, message: object) -> None:
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


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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


def invite_new_member(
    client: TestClient,
    outbox_dir: Path,
    actor_token: str,
    *,
    email: str,
    role: str,
    display_name: str,
) -> dict[str, Any]:
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(actor_token),
        json={"email": email, "role": role},
    )
    assert invitation_response.status_code == 201
    message = latest_outbox_message(outbox_dir, email, "workspace_invitation")
    accepted_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": display_name,
        },
    )
    assert accepted_response.status_code == 201
    return accepted_response.json()["data"]


def test_owner_invites_new_editor_and_invitee_accepts_from_email(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)

    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "editor"},
    )

    assert invitation_response.status_code == 201
    invitation = invitation_response.json()["data"]
    assert invitation["email"] == "member@example.com"
    assert invitation["role"] == "editor"
    assert invitation["status"] == "pending"
    assert (
        invitation["expires_at_ms"] - invitation["created_at_ms"] == 24 * 60 * 60 * 1000
    )
    assert invitation["email_sent"] is True
    assert "token" not in invitation
    assert "accept_url" not in invitation

    message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )
    accepted_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": "Member",
        },
    )
    assert accepted_response.status_code == 201
    accepted = accepted_response.json()["data"]
    assert accepted["user"]["email"] == "member@example.com"
    assert accepted["membership"]["role"] == "editor"
    assert accepted["membership"]["status"] == "active"
    assert accepted["access_token"]
    assert accepted["refresh_token"]

    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    assert members_response.status_code == 200
    assert [item["role"] for item in members_response.json()["data"]["items"]] == [
        "owner",
        "editor",
    ]


def test_owner_changes_non_owner_member_role(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    accepted = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="editor@example.com",
        role="editor",
        display_name="Editor",
    )

    update_response = client.patch(
        f"/workspace/members/{accepted['membership']['id']}",
        headers=auth_header(owner["access_token"]),
        json={"role": "normal"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["data"]["role"] == "normal"
    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    assert [item["role"] for item in members_response.json()["data"]["items"]] == [
        "owner",
        "normal",
    ]


def test_admin_cannot_invite_another_admin(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="admin@example.com",
        role="admin",
        display_name="Admin",
    )

    response = client.post(
        "/workspace/invitations",
        headers=auth_header(admin["access_token"]),
        json={"email": "second-admin@example.com", "role": "admin"},
    )

    assert response.status_code == 403


def test_admin_cannot_change_owner_role(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="admin@example.com",
        role="admin",
        display_name="Admin",
    )
    members_response = client.get(
        "/workspace/members",
        headers=auth_header(admin["access_token"]),
    )
    owner_member = next(
        item for item in members_response.json()["data"]["items"] if item["role"] == "owner"
    )

    response = client.patch(
        f"/workspace/members/{owner_member['id']}",
        headers=auth_header(admin["access_token"]),
        json={"role": "normal"},
    )

    assert response.status_code == 403


def test_admin_cannot_change_another_admin_role(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    first_admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="first-admin@example.com",
        role="admin",
        display_name="First Admin",
    )
    second_admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="second-admin@example.com",
        role="admin",
        display_name="Second Admin",
    )

    response = client.patch(
        f"/workspace/members/{second_admin['membership']['id']}",
        headers=auth_header(first_admin["access_token"]),
        json={"role": "normal"},
    )

    assert response.status_code == 403


def test_admin_invites_editor_and_changes_role_between_editor_and_normal(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="admin@example.com",
        role="admin",
        display_name="Admin",
    )

    editor = invite_new_member(
        client,
        outbox_dir,
        admin["access_token"],
        email="editor@example.com",
        role="editor",
        display_name="Editor",
    )
    response = client.patch(
        f"/workspace/members/{editor['membership']['id']}",
        headers=auth_header(admin["access_token"]),
        json={"role": "normal"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["role"] == "normal"


@pytest.mark.parametrize("role", ["editor", "normal"])
def test_non_admin_member_cannot_create_invitations(
    client: TestClient,
    outbox_dir: Path,
    role: str,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email=f"{role}@example.com",
        role=role,
        display_name=role.title(),
    )

    response = client.post(
        "/workspace/invitations",
        headers=auth_header(member["access_token"]),
        json={"email": "another@example.com", "role": "normal"},
    )

    assert response.status_code == 403


def test_owner_removes_member_without_deleting_account(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )

    remove_response = client.delete(
        f"/workspace/members/{member['membership']['id']}",
        headers=auth_header(owner["access_token"]),
    )

    assert remove_response.status_code == 200
    assert remove_response.json()["data"] is None
    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    assert [item["role"] for item in members_response.json()["data"]["items"]] == ["owner"]
    removed_access_response = client.get(
        "/workspace/members",
        headers=auth_header(member["access_token"]),
    )
    assert removed_access_response.status_code == 403


def test_removed_member_cannot_log_in(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )
    assert (
        client.delete(
            f"/workspace/members/{member['membership']['id']}",
            headers=auth_header(owner["access_token"]),
        ).status_code
        == 200
    )

    response = client.post(
        "/auth/login",
        json={"email": "member@example.com", "password": PASSWORD},
    )

    assert response.status_code == 401


def test_removed_member_cannot_refresh_access_token(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )
    assert (
        client.delete(
            f"/workspace/members/{member['membership']['id']}",
            headers=auth_header(owner["access_token"]),
        ).status_code
        == 200
    )

    response = client.post(
        "/auth/refresh",
        json={"refresh_token": member["refresh_token"]},
    )

    assert response.status_code == 401


def test_owner_cannot_remove_the_only_owner(client: TestClient) -> None:
    owner = setup_owner(client)
    members_response = client.get(
        "/workspace/members",
        headers=auth_header(owner["access_token"]),
    )
    owner_member = members_response.json()["data"]["items"][0]

    response = client.delete(
        f"/workspace/members/{owner_member['id']}",
        headers=auth_header(owner["access_token"]),
    )

    assert response.status_code == 403


def test_admin_cannot_remove_another_admin(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    first_admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="first-admin@example.com",
        role="admin",
        display_name="First Admin",
    )
    second_admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="second-admin@example.com",
        role="admin",
        display_name="Second Admin",
    )

    response = client.delete(
        f"/workspace/members/{second_admin['membership']['id']}",
        headers=auth_header(first_admin["access_token"]),
    )

    assert response.status_code == 403


@pytest.mark.parametrize("target_role", ["editor", "normal"])
def test_admin_removes_editor_or_normal_member(
    client: TestClient,
    outbox_dir: Path,
    target_role: str,
) -> None:
    owner = setup_owner(client)
    admin = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="admin@example.com",
        role="admin",
        display_name="Admin",
    )
    target = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email=f"{target_role}@example.com",
        role=target_role,
        display_name=target_role.title(),
    )

    response = client.delete(
        f"/workspace/members/{target['membership']['id']}",
        headers=auth_header(admin["access_token"]),
    )

    assert response.status_code == 200
    assert response.json()["data"] is None


def test_invitation_is_unavailable_when_mail_is_not_configured(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'disabled-mail.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes"
    )
    monkeypatch.delenv("ORBIS_MAIL_TRANSPORT", raising=False)

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        owner = setup_owner(test_client)
        response = test_client.post(
            "/workspace/invitations",
            headers=auth_header(owner["access_token"]),
            json={"email": "member@example.com", "role": "normal"},
        )

    assert response.status_code == 503


def test_delivery_failure_keeps_pending_invitation_with_safe_error_summary(
    client: TestClient,
) -> None:
    owner = setup_owner(client)
    client.app.state.mail_sender = FailingMailSender()

    response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "normal"},
    )

    assert response.status_code == 201
    invitation = response.json()["data"]
    assert invitation["status"] == "pending"
    assert invitation["email_sent"] is False
    assert invitation["email_error_summary"] == "SMTP connection timed out"


def test_owner_revokes_pending_invitation_and_token_cannot_be_used(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "normal"},
    )
    invitation = invitation_response.json()["data"]
    message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )

    revoke_response = client.delete(
        f"/workspace/invitations/{invitation['id']}",
        headers=auth_header(owner["access_token"]),
    )

    assert revoke_response.status_code == 200
    assert revoke_response.json()["data"] is None
    accept_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": "Member",
        },
    )
    assert accept_response.status_code == 409


def test_expired_invitation_is_marked_expired_and_cannot_be_reused(
    client: TestClient,
    outbox_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = setup_owner(client)
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "normal"},
    )
    invitation = invitation_response.json()["data"]
    message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )

    monkeypatch.setattr(
        "orbis_user_api.services.invitation.now_ms",
        lambda: invitation["expires_at_ms"] + 1,
    )
    accept_payload = {
        "token": message["token"],
        "password": PASSWORD,
        "display_name": "Member",
    }
    first_response = client.post("/workspace/invitations/accept", json=accept_payload)
    second_response = client.post("/workspace/invitations/accept", json=accept_payload)

    assert first_response.status_code == 409
    assert first_response.json()["code"] == "INVITATION_EXPIRED"
    assert second_response.status_code == 409


def test_member_manager_lists_invitation_without_secret_token(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )

    response = client.get(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
    )

    assert response.status_code == 200
    invitation = response.json()["data"]["items"][0]
    assert invitation["status"] == "accepted"
    assert "token" not in invitation
    assert "accept_url" not in invitation


def test_resend_rotates_invitation_token_and_restarts_original_ttl(
    client: TestClient,
    outbox_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = setup_owner(client)
    create_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={
            "email": "member@example.com",
            "role": "normal",
            "expires_in_seconds": 3600,
        },
    )
    invitation = create_response.json()["data"]
    first_message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )
    monkeypatch.setattr(
        "orbis_user_api.services.invitation.now_ms",
        lambda: invitation["created_at_ms"] + 30_000,
    )

    resend_response = client.post(
        f"/workspace/invitations/{invitation['id']}/resend",
        headers=auth_header(owner["access_token"]),
    )

    assert resend_response.status_code == 200
    resent = resend_response.json()["data"]
    assert resent["expires_at_ms"] == invitation["created_at_ms"] + 30_000 + 3_600_000
    second_message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )
    assert second_message["token"] != first_message["token"]

    old_token_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": first_message["token"],
            "password": PASSWORD,
            "display_name": "Member",
        },
    )
    assert old_token_response.status_code == 409
    new_token_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": second_message["token"],
            "password": PASSWORD,
            "display_name": "Member",
        },
    )
    assert new_token_response.status_code == 201


def test_invitation_ttl_cannot_exceed_seven_days(
    client: TestClient,
) -> None:
    owner = setup_owner(client)

    response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={
            "email": "member@example.com",
            "role": "normal",
            "expires_in_seconds": 7 * 24 * 60 * 60 + 1,
        },
    )

    assert response.status_code == 409


def test_new_invitation_for_same_email_revokes_previous_invitation(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    first_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "editor"},
    )
    assert first_response.status_code == 201
    first_message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )

    second_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "normal"},
    )
    assert second_response.status_code == 201

    old_token_response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": first_message["token"],
            "password": PASSWORD,
            "display_name": "Member",
        },
    )
    assert old_token_response.status_code == 409

    list_response = client.get(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
    )
    assert [item["status"] for item in list_response.json()["data"]["items"]] == [
        "pending",
        "revoked",
    ]


def test_existing_removed_account_must_sign_in_before_accepting_reinvite(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )
    assert (
        client.delete(
            f"/workspace/members/{member['membership']['id']}",
            headers=auth_header(owner["access_token"]),
        ).status_code
        == 200
    )
    reinvite_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "editor"},
    )
    assert reinvite_response.status_code == 201
    message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )

    anonymous_response = client.post(
        "/workspace/invitations/accept",
        json={"token": message["token"]},
    )
    assert anonymous_response.status_code == 401

    login_response = client.post(
        "/auth/login",
        json={"email": "member@example.com", "password": PASSWORD},
    )
    assert login_response.status_code == 200
    accept_response = client.post(
        "/workspace/invitations/accept",
        headers=auth_header(login_response.json()["data"]["access_token"]),
        json={"token": message["token"]},
    )

    assert accept_response.status_code == 201
    accepted = accept_response.json()["data"]
    assert accepted["membership"]["role"] == "editor"
    assert accepted["membership"]["status"] == "active"
    assert accepted["access_token"] is None
    assert accepted["refresh_token"] is None


def test_mail_status_exposes_availability_without_smtp_secrets(
    client: TestClient,
) -> None:
    owner = setup_owner(client)

    response = client.get(
        "/workspace/mail-status",
        headers=auth_header(owner["access_token"]),
    )

    assert response.status_code == 200
    assert response.json()["data"] == {"available": True, "transport": "outbox"}


def test_normal_member_reads_but_cannot_create_application_resources(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    member = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="member@example.com",
        role="normal",
        display_name="Member",
    )
    headers = auth_header(member["access_token"])

    read_response = client.get("/document-groups", headers=headers)
    create_response = client.post(
        "/document-groups",
        headers=headers,
        json={"name": "Forbidden group"},
    )

    assert read_response.status_code == 200
    assert create_response.status_code == 403


def test_editor_member_creates_application_resources(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    editor = invite_new_member(
        client,
        outbox_dir,
        owner["access_token"],
        email="editor@example.com",
        role="editor",
        display_name="Editor",
    )

    response = client.post(
        "/document-groups",
        headers=auth_header(editor["access_token"]),
        json={"name": "Editor group"},
    )

    assert response.status_code == 201


def test_new_invitee_display_name_cannot_be_blank(
    client: TestClient,
    outbox_dir: Path,
) -> None:
    owner = setup_owner(client)
    invitation_response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner["access_token"]),
        json={"email": "member@example.com", "role": "normal"},
    )
    assert invitation_response.status_code == 201
    message = latest_outbox_message(
        outbox_dir, "member@example.com", "workspace_invitation"
    )

    response = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": "   ",
        },
    )

    assert response.status_code == 422
