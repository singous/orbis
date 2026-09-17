from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.workspace import WorkspaceMember
from sqlalchemy import select

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'files.db'}"
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
def owner(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def upload_file(
    client: TestClient,
    owner: dict[str, str],
    *,
    filename: str = "guide.txt",
    contents: bytes = b"Orbis file contents",
    media_type: str = "text/plain",
) -> dict[str, object]:
    response = client.post(
        "/files",
        headers=owner,
        files={"file": (filename, contents, media_type)},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_authenticated_workspace_member_reads_uploaded_bytes(
    client: TestClient, owner: dict[str, str]
) -> None:
    uploaded = upload_file(client, owner, filename="使用说明.txt")

    response = client.get(f"/files/{uploaded['id']}/content", headers=owner)

    assert response.status_code == 200, response.text
    assert response.content == b"Orbis file contents"
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["content-disposition"].startswith("attachment;")
    assert "filename*=utf-8''" in response.headers["content-disposition"].lower()
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; sandbox; frame-ancestors 'none'"
    )
    assert "code" not in response.text


def test_file_content_requires_authentication(
    client: TestClient, owner: dict[str, str]
) -> None:
    uploaded = upload_file(client, owner)

    response = client.get(f"/files/{uploaded['id']}/content")

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_REQUIRED"


def test_file_content_supports_http_range_requests(
    client: TestClient, owner: dict[str, str]
) -> None:
    uploaded = upload_file(client, owner, contents=b"0123456789")

    response = client.get(
        f"/files/{uploaded['id']}/content",
        headers={**owner, "Range": "bytes=2-5"},
    )

    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["accept-ranges"] == "bytes"


def test_file_content_range_validation_preserves_if_range_semantics(
    client: TestClient, owner: dict[str, str]
) -> None:
    uploaded = upload_file(client, owner, contents=b"0123456789")
    url = f"/files/{uploaded['id']}/content"
    initial = client.get(url, headers=owner)

    matching = client.get(
        url,
        headers={**owner, "Range": "bytes=2-5", "If-Range": initial.headers["etag"]},
    )
    stale = client.get(
        url,
        headers={**owner, "Range": "items=0-2", "If-Range": '"stale-etag"'},
    )

    assert matching.status_code == 206
    assert matching.content == b"2345"
    assert stale.status_code == 200
    assert stale.content == b"0123456789"


@pytest.mark.parametrize(
    "range_header,expected_status,expected_code",
    [
        ("items=0-2", 400, "INVALID_RANGE"),
        ("bytes=999-1000", 416, "RANGE_NOT_SATISFIABLE"),
    ],
    ids=["malformed", "unsatisfiable"],
)
def test_invalid_file_ranges_use_json_errors_and_security_headers(
    client: TestClient,
    owner: dict[str, str],
    range_header: str,
    expected_status: int,
    expected_code: str,
) -> None:
    uploaded = upload_file(client, owner, contents=b"0123456789")

    response = client.get(
        f"/files/{uploaded['id']}/content",
        headers={**owner, "Range": range_header},
    )

    assert response.status_code == expected_status
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; sandbox; frame-ancestors 'none'"
    )
    payload = response.json()
    assert payload == {
        "code": expected_code,
        "message": (
            "Range 请求头格式无效"
            if expected_status == 400
            else "请求的文件范围无法满足"
        ),
        "request_id": response.headers["x-request-id"],
        "data": None,
    }
    if expected_status == 416:
        assert response.headers["content-range"] == "bytes */10"
    else:
        assert "content-range" not in response.headers


@pytest.mark.parametrize("failure", ["foreign", "incomplete", "missing-bytes"])
def test_unavailable_file_returns_same_not_found_contract(
    client: TestClient, owner: dict[str, str], failure: str
) -> None:
    uploaded = upload_file(client, owner)

    async def make_unavailable() -> None:
        async with client.app.state.session_factory() as session:
            asset = await session.get(FileAsset, UUID(str(uploaded["id"])))
            assert asset is not None
            if failure == "foreign":
                asset.workspace_id = new_uuidv7()
            elif failure == "incomplete":
                asset.upload_status = "processing"
            else:
                (client.app.state.storage.root / asset.storage_key).unlink()
            await session.commit()

    client.portal.call(make_unavailable)
    response = client.get(f"/files/{uploaded['id']}/content", headers=owner)

    assert response.status_code == 404
    assert response.json()["code"] == "FILE_NOT_FOUND"
    assert "storage" not in response.text.lower()


def test_inactive_workspace_membership_cannot_read_file(
    client: TestClient, owner: dict[str, str]
) -> None:
    uploaded = upload_file(client, owner)

    async def deactivate_membership() -> None:
        async with client.app.state.session_factory() as session:
            membership = (await session.scalars(select(WorkspaceMember))).one()
            membership.status = "inactive"
            await session.commit()

    client.portal.call(deactivate_membership)
    response = client.get(f"/files/{uploaded['id']}/content", headers=owner)

    assert response.status_code == 404
    assert response.json()["code"] == "FILE_NOT_FOUND"


@pytest.mark.parametrize(
    "filename,contents,media_type,expected_type,disposition",
    [
        ("cover.png", b"\x89PNG\r\n\x1a\ncontent", "image/png", "image/png", "inline"),
        (
            "page.html",
            b"<script>alert(1)</script>",
            "text/html",
            "application/octet-stream",
            "attachment",
        ),
        (
            "vector.svg",
            b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            "image/svg+xml",
            "application/octet-stream",
            "attachment",
        ),
        (
            "payload.custom",
            b"unknown",
            "application/x-orbis-test",
            "application/octet-stream",
            "attachment",
        ),
    ],
    ids=["inert-image", "html", "svg", "unknown"],
)
def test_file_content_applies_safe_mime_and_disposition_headers(
    client: TestClient,
    owner: dict[str, str],
    filename: str,
    contents: bytes,
    media_type: str,
    expected_type: str,
    disposition: str,
) -> None:
    uploaded = upload_file(
        client,
        owner,
        filename=filename,
        contents=contents,
        media_type=media_type,
    )

    response = client.get(f"/files/{uploaded['id']}/content", headers=owner)

    assert response.status_code == 200
    assert response.content == contents
    assert response.headers["content-type"].startswith(expected_type)
    assert response.headers["content-disposition"].startswith(f"{disposition};")


def test_file_content_rejects_storage_keys_that_escape_the_storage_root(
    client: TestClient, owner: dict[str, str], tmp_path: Path
) -> None:
    uploaded = upload_file(client, owner)
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"private")

    async def replace_storage_key() -> None:
        async with client.app.state.session_factory() as session:
            asset = await session.get(FileAsset, UUID(str(uploaded["id"])))
            assert asset is not None
            asset.storage_key = str(outside)
            await session.commit()

    client.portal.call(replace_storage_key)
    response = client.get(f"/files/{uploaded['id']}/content", headers=owner)

    assert response.status_code == 404
    assert response.json()["code"] == "FILE_NOT_FOUND"


def test_file_content_openapi_documents_binary_success_and_json_errors() -> None:
    from orbis_user_api.main import create_app

    operation = create_app().openapi()["paths"]["/files/{file_id}/content"]["get"]

    assert "读取文件内容" in operation["summary"]
    assert "二进制" in operation["description"]
    assert operation["parameters"][0]["description"] == "要读取的文件 UUID。"
    assert operation["responses"]["200"]["content"] == {
        "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
    }
    errors = operation["responses"]
    assert "FILE_NOT_FOUND" in errors["404"]["content"]["application/json"]["examples"]
    assert "INVALID_RANGE" in errors["400"]["content"]["application/json"]["examples"]
    assert (
        "RANGE_NOT_SATISFIABLE"
        in errors["416"]["content"]["application/json"]["examples"]
    )
    assert errors["416"]["headers"]["Content-Range"]["schema"] == {"type": "string"}
