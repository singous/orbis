from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'sharing.db'}"
    )
    monkeypatch.setenv("ORBIS_STORAGE_DIR", str(tmp_path / "files"))
    monkeypatch.setenv("ORBIS_AUTO_CREATE_TABLES", "true")
    monkeypatch.setenv(
        "ORBIS_ACCESS_TOKEN_SECRET", "sharing-access-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_REFRESH_TOKEN_SECRET", "sharing-refresh-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv(
        "ORBIS_ACTION_TOKEN_SECRET", "sharing-action-secret-with-at-least-32-bytes"
    )
    monkeypatch.setenv("ORBIS_MAIL_TRANSPORT", "outbox")
    monkeypatch.setenv("ORBIS_MAIL_OUTBOX_DIR", str(tmp_path / "outbox"))
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as value:
        yield value


@pytest.fixture()
def owner(client: TestClient):
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": "correct horse battery staple",
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}
