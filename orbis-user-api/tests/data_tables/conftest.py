from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    for key, value in {
        "ORBIS_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'tables.db'}",
        "ORBIS_STORAGE_DIR": str(tmp_path / "files"),
        "ORBIS_AUTO_CREATE_TABLES": "true",
        "ORBIS_ACCESS_TOKEN_SECRET": "isolated-table-access-secret-at-least-32-bytes",
        "ORBIS_REFRESH_TOKEN_SECRET": "isolated-table-refresh-secret-at-least-32-bytes",
        "ORBIS_ACTION_TOKEN_SECRET": "isolated-table-action-secret-at-least-32-bytes",
    }.items():
        monkeypatch.setenv(key, value)
    from orbis_user_api.main import create_app

    with TestClient(create_app()) as value:
        yield value
