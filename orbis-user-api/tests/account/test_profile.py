from __future__ import annotations

import base64
import io
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.workspace import WorkspaceMember
from PIL import Image, PngImagePlugin
from sqlalchemy import select


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'profiles.db'}"
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


@pytest.fixture()
def owner(client: TestClient) -> dict[str, str]:
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


def image_bytes(format: str = "PNG", size: tuple[int, int] = (640, 320)) -> bytes:
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("private-comment", "Remove this metadata")
    Image.new("RGB", size, "#54b3be").save(output, format=format, pnginfo=metadata)
    return output.getvalue()


def test_profile_edit_is_persisted_without_changing_login(client, owner):
    response = client.patch("/users/me", headers=owner, json={"display_name": "  新名称  ", "bio": "我的知识笔记"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["display_name"] == "新名称"
    saved = client.get("/users/me", headers=owner).json()["data"]
    assert saved["bio"] == "我的知识笔记"
    assert saved["email"] == "owner@example.com"
    assert client.patch("/users/me", headers=owner, json={"display_name": "   "}).status_code == 422
    assert client.patch("/users/me", headers=owner, json={"email": "other@example.com"}).status_code == 422
    assert client.patch("/users/me", json={"display_name": "No access"}).status_code == 401


def test_avatar_upload_read_replace_and_remove(client, owner, tmp_path):
    response = client.put("/users/me/avatar", headers=owner, files={"file": ("avatar.png", image_bytes(), "image/png")})
    assert response.status_code == 200, response.text
    first_id = response.json()["data"]["avatar_file_id"]
    assert first_id
    image = client.get("/users/me/avatar", headers=owner).json()["data"]["data_url"]
    with Image.open(io.BytesIO(base64.b64decode(image.split(",", 1)[1]))) as thumbnail:
        assert thumbnail.size == (256, 256)
        assert "private-comment" not in thumbnail.info
    invalid = client.put("/users/me/avatar", headers=owner, files={"file": ("bad.png", b"bad image", "image/png")})
    assert invalid.status_code == 422
    assert client.get("/users/me", headers=owner).json()["data"]["avatar_file_id"] == first_id
    assert client.get("/users/me/avatar").status_code == 401
    second = client.put("/users/me/avatar", headers=owner, files={"file": ("avatar.webp", image_bytes("WEBP"), "image/webp")})
    assert second.json()["data"]["avatar_file_id"] != first_id
    assert len(list((tmp_path / "storage").rglob("avatar.webp"))) == 1
    assert client.delete("/users/me/avatar", headers=owner).json()["data"]["avatar_file_id"] is None
    assert client.get("/users/me/avatar", headers=owner).status_code == 404
    assert client.get("/users/me", headers=owner).json()["data"]["avatar_file_id"] is None


def test_avatar_size_and_content_limits(client, owner):
    oversized = client.put("/users/me/avatar", headers=owner, files={"file": ("large.png", b"x" * (2 * 1024 * 1024 + 1), "image/png")})
    assert oversized.status_code == 413
    svg = client.put("/users/me/avatar", headers=owner, files={"file": ("avatar.svg", b"<svg></svg>", "image/svg+xml")})
    assert svg.status_code == 422


def test_corrupt_png_checksum_returns_validation_error(client, owner):
    broken = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=")
    response = client.put("/users/me/avatar", headers=owner, files={"file": ("broken.png", broken, "image/png")})
    assert response.status_code == 422
    assert response.json()["code"] == "AVATAR_INVALID_IMAGE"
