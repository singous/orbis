from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
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

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_setup_creates_only_owner_and_default_private_workspace(
    client: TestClient,
) -> None:
    response = client.post(
        "/setup",
        json={
            "email": " Owner@Example.com ",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["refresh_token"]
    assert payload["user"]["email"] == "owner@example.com"
    assert "is_superuser" not in payload["user"]
    assert payload["workspace"]["name"] == "私人空间"
    assert payload["workspace"]["workspace_type"] == "private"
    assert payload["workspace"]["role"] == "owner"
    assert payload["workspace"]["is_current"] is True

    me_response = client.get(
        "/users/me",
        headers=auth_header(payload["access_token"]),
    )
    assert me_response.status_code == 200
    assert me_response.json()["id"] == payload["user"]["id"]

    login_response = client.post(
        "/auth/login",
        json={"email": "owner@example.com", "password": PASSWORD},
    )
    assert login_response.status_code == 200
    assert login_response.json()["user"]["id"] == payload["user"]["id"]
    assert login_response.json()["workspace"]["role"] == "owner"

    refresh_response = client.post(
        "/auth/refresh",
        json={"refresh_token": login_response.json()["refresh_token"]},
    )
    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]

    repeated_response = client.post(
        "/setup",
        json={
            "email": "second@example.com",
            "password": PASSWORD,
            "display_name": "Second",
        },
    )
    assert repeated_response.status_code == 409
    assert repeated_response.json()["detail"] == "System is already initialized"


def test_community_mode_hides_public_registration_and_workspace_management(
    client: TestClient,
) -> None:
    assert client.post("/auth/register", json={}).status_code == 404
    assert client.post("/auth/email-codes", json={}).status_code == 404
    assert client.post("/auth/logout", json={}).status_code == 404
    assert client.get("/setup/status").status_code == 404
    assert client.get("/workspaces").status_code == 404
    assert client.get("/workspaces/current").status_code == 404
    assert client.put("/workspaces/current", json={}).status_code == 404


def test_legacy_bootstrap_environment_cannot_bypass_setup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv("ORBIS_BOOTSTRAP_SUPERUSER_ENABLED", "true")
    monkeypatch.setenv("ORBIS_BOOTSTRAP_SUPERUSER_EMAIL", "legacy@example.com")
    monkeypatch.setenv("ORBIS_BOOTSTRAP_SUPERUSER_PASSWORD", "legacy-password")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "test-access-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "test-refresh-secret-with-at-least-32-bytes"
    )

    from orbis_user_api.main import create_app

    with TestClient(create_app()) as test_client:
        setup_response = test_client.post(
            "/setup",
            json={
                "email": "owner@example.com",
                "password": PASSWORD,
                "display_name": "Owner",
            },
        )
        assert setup_response.status_code == 201
        assert (
            test_client.post(
                "/auth/login",
                json={"email": "legacy@example.com", "password": "legacy-password"},
            ).status_code
            == 401
        )


def test_community_token_ttl_defaults_match_product_contract(
    client: TestClient,
) -> None:
    assert client.app.state.settings.access_token_ttl_seconds == 2 * 60 * 60
    assert client.app.state.settings.refresh_token_ttl_seconds == 30 * 24 * 60 * 60
