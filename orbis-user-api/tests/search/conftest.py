from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    for key, value in {
        "ORBIS_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'search.db'}",
        "ORBIS_STORAGE_DIR": str(tmp_path / "storage"),
        "ORBIS_AUTO_CREATE_TABLES": "true",
        "ORBIS_ACCESS_TOKEN_SECRET": "search-test-access-secret-at-least-32-bytes",
        "ORBIS_REFRESH_TOKEN_SECRET": "search-test-refresh-secret-at-least-32-bytes",
    }.items():
        monkeypatch.setenv(key, value)
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as instance:
        yield instance


@pytest.fixture()
def actor(client):
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": "search integration password",
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    return data, {"Authorization": f"Bearer {data['access_token']}"}
