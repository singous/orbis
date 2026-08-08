from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

PASSWORD = "correct horse battery staple"


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
    return response.json()


def invite_member(
    client: TestClient,
    owner_token: str,
    *,
    email: str,
    role: str,
) -> dict[str, Any]:
    response = client.post(
        "/workspace/invitations",
        headers=auth_header(owner_token),
        json={"email": email, "role": role},
    )
    assert response.status_code == 201
    outbox_dir = Path(client.app.state.settings.mail_outbox_dir)
    messages = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in outbox_dir.glob("*.json")
    ]
    message = next(item for item in messages if item["recipient"] == email)
    accepted = client.post(
        "/workspace/invitations/accept",
        json={
            "token": message["token"],
            "password": PASSWORD,
            "display_name": role.title(),
        },
    )
    assert accepted.status_code == 201
    return accepted.json()


def create_knowledge_base(
    client: TestClient, token: str, *, name: str = "Orbis docs"
) -> dict[str, Any]:
    response = client.post(
        "/knowledge-bases",
        headers=auth_header(token),
        json={"name": name, "description": "Product knowledge"},
    )
    assert response.status_code == 201
    return response.json()
