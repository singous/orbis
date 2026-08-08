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


def setup_owner(client: TestClient) -> str:
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201
    return response.json()["data"]["access_token"]


def test_flat_list_operations_share_the_same_pagination_contract() -> None:
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    flat_lists = {
        "/notes",
        "/document-groups",
        "/notebooks",
        "/files",
        "/workspace/invitations",
        "/workspace/members",
    }

    for path in flat_lists:
        operation = schema["paths"][path]["get"]
        query_parameters = {
            parameter["name"]: parameter
            for parameter in operation["parameters"]
            if parameter["in"] == "query"
        }
        assert query_parameters["page"]["schema"]["default"] == 1
        assert query_parameters["page"]["schema"]["minimum"] == 1
        assert query_parameters["page_size"]["schema"]["default"] == 20
        assert query_parameters["page_size"]["schema"]["minimum"] == 1
        assert query_parameters["page_size"]["schema"]["maximum"] == 100


def test_document_group_list_returns_database_backed_pagination(
    client: TestClient,
) -> None:
    token = setup_owner(client)
    headers = auth_header(token)
    for index in range(1, 5):
        response = client.post(
            "/document-groups",
            headers=headers,
            json={"name": f"分组 {index}", "sort_order": index},
        )
        assert response.status_code == 201

    response = client.get(
        "/document-groups?page=2&page_size=2",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert [item["name"] for item in data["items"]] == ["分组 2", "分组 3"]
    assert data["pagination"] == {
        "page": 2,
        "page_size": 2,
        "total": 5,
        "total_pages": 3,
        "has_next": True,
        "has_previous": True,
    }


def test_page_size_above_shared_limit_uses_validation_error_envelope(
    client: TestClient,
) -> None:
    token = setup_owner(client)

    response = client.get(
        "/document-groups?page_size=101",
        headers=auth_header(token),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
