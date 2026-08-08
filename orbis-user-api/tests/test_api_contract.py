from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbis_user_api.api.contract import install_api_contract
from orbis_user_api.api.errors import ApiError


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'contract.db'}"
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

    with TestClient(create_app(), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture()
def contract_client() -> TestClient:
    app = FastAPI()
    install_api_contract(app)

    @app.get("/business-error")
    async def business_error() -> None:
        raise ApiError(
            status_code=409,
            code="DOCUMENT_VERSION_CONFLICT",
            message="文档已被其他成员更新，请刷新后重试",
            data={"expected_version": 2, "current_version": 3},
        )

    @app.get("/unexpected-error")
    async def unexpected_error() -> None:
        raise RuntimeError("database password must not reach the client")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def assert_request_id_contract(response) -> dict:
    payload = response.json()
    assert set(payload) == {"code", "message", "request_id", "data"}
    assert payload["request_id"] == response.headers["X-Request-ID"]
    assert len(payload["request_id"]) == 36
    return payload


def test_health_response_uses_the_unified_success_envelope(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    payload = assert_request_id_contract(response)
    assert payload["code"] == "OK"
    assert payload["message"] == "请求成功"
    assert payload["data"] == {"status": "ok"}


def test_request_validation_uses_the_unified_error_envelope(
    client: TestClient,
) -> None:
    response = client.post("/setup", json={})

    assert response.status_code == 422
    payload = assert_request_id_contract(response)
    assert payload["code"] == "VALIDATION_ERROR"
    assert payload["message"] == "请求字段校验失败"
    assert payload["data"] == {
        "errors": [
            {
                "field": "body.email",
                "code": "MISSING",
                "message": "字段为必填项",
            },
            {
                "field": "body.password",
                "code": "MISSING",
                "message": "字段为必填项",
            },
            {
                "field": "body.display_name",
                "code": "MISSING",
                "message": "字段为必填项",
            },
        ]
    }
    assert "detail" not in payload


def test_unknown_route_uses_the_unified_not_found_envelope(
    client: TestClient,
) -> None:
    response = client.get("/does-not-exist")

    assert response.status_code == 404
    payload = assert_request_id_contract(response)
    assert payload == {
        "code": "RESOURCE_NOT_FOUND",
        "message": "请求的资源不存在",
        "request_id": response.headers["X-Request-ID"],
        "data": None,
    }


def test_business_error_preserves_stable_code_and_structured_data(
    contract_client: TestClient,
) -> None:
    response = contract_client.get("/business-error")

    assert response.status_code == 409
    payload = assert_request_id_contract(response)
    assert payload == {
        "code": "DOCUMENT_VERSION_CONFLICT",
        "message": "文档已被其他成员更新，请刷新后重试",
        "request_id": response.headers["X-Request-ID"],
        "data": {"expected_version": 2, "current_version": 3},
    }


def test_unhandled_exception_is_sanitized(
    contract_client: TestClient,
) -> None:
    response = contract_client.get("/unexpected-error")

    assert response.status_code == 500
    payload = assert_request_id_contract(response)
    assert payload == {
        "code": "INTERNAL_ERROR",
        "message": "服务内部错误",
        "request_id": response.headers["X-Request-ID"],
        "data": None,
    }
    assert "password" not in response.text


def test_all_json_operations_document_the_unified_success_envelope() -> None:
    from orbis_user_api.main import create_app

    spec = create_app().openapi()
    components = spec["components"]["schemas"]
    operations = []
    for path, path_item in spec["paths"].items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            operations.append((method.upper(), path, operation))

    assert len(operations) == 42
    for method, path, operation in operations:
        success_responses = [
            (status_code, response)
            for status_code, response in operation["responses"].items()
            if status_code.startswith("2")
        ]
        assert len(success_responses) == 1, (method, path, success_responses)
        status_code, response = success_responses[0]
        assert status_code != "204", (method, path)
        schema = response["content"]["application/json"]["schema"]
        if "$ref" in schema:
            schema = components[schema["$ref"].rsplit("/", 1)[-1]]
        assert set(schema["properties"]) == {
            "code",
            "message",
            "request_id",
            "data",
        }, (method, path, schema)
