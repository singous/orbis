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
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'icons.db'}"
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


def upload_icon(client: TestClient, owner: dict[str, str]):
    response = client.post(
        "/notebooks/icons",
        headers=owner,
        files={
            "file": ("my-icon.png", image_bytes(), "image/png"),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_legacy_notebooks_default_to_no_icon(client: TestClient, owner: dict[str, str]):
    created = client.post("/notebooks", headers=owner, json={"title": "Legacy"})
    assert created.status_code == 201
    assert created.json()["data"]["icon"] is None
    listed = client.get("/notebooks", headers=owner).json()["data"]["items"]
    assert listed[0]["icon"] is None


def test_preset_icon_survives_rename_and_supports_replace_and_reset(
    client: TestClient, owner: dict[str, str]
):
    preset = {"type": "preset", "name": "palette", "color": "violet"}
    created = client.post(
        "/notebooks", headers=owner, json={"title": "Design", "icon": preset}
    )
    assert created.status_code == 201
    notebook = created.json()["data"]
    assert notebook["icon"] == preset
    url = f"/notebooks/{notebook['id']}"
    renamed = client.patch(url, headers=owner, json={"title": "Design system"})
    assert renamed.json()["data"]["icon"] == preset
    replacement = {"type": "preset", "name": "code", "color": "mint"}
    replaced = client.patch(url, headers=owner, json={"icon": replacement})
    assert replaced.json()["data"]["icon"] == replacement
    reset = client.patch(url, headers=owner, json={"icon": None})
    assert reset.json()["data"]["icon"] is None


@pytest.mark.parametrize(
    "icon",
    [
        {"type": "preset", "name": "unknown", "color": "blue"},
        {"type": "preset", "name": "book", "color": "javascript:red"},
        {"type": "image", "file_id": "https://example.com/image.svg"},
        {"type": "image", "file_id": str(new_uuidv7()), "url": "https://example.com"},
    ],
)
def test_invalid_icon_contract_is_rejected(
    client: TestClient, owner: dict[str, str], icon: dict
):
    response = client.post(
        "/notebooks", headers=owner, json={"title": "Invalid", "icon": icon}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "format,mime",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
)
def test_upload_is_normalized_and_can_be_read_and_bound(
    client: TestClient, owner: dict[str, str], format: str, mime: str
):
    uploaded = client.post(
        "/notebooks/icons",
        headers=owner,
        files={
            "file": ("icon", image_bytes(format), mime),
        },
    )
    assert uploaded.status_code == 201, uploaded.text
    icon = uploaded.json()["data"]
    assert UUID(icon["file_id"]).version == 7
    assert icon["data_url"].startswith("data:image/webp;base64,")
    normalized = base64.b64decode(icon["data_url"].split(",", 1)[1])
    with Image.open(io.BytesIO(normalized)) as image:
        assert image.format == "WEBP"
        assert image.size == (256, 128)
        assert "private-comment" not in image.info
    retrieved = client.get(f"/notebooks/icons/{icon['file_id']}", headers=owner)
    assert retrieved.status_code == 200
    assert retrieved.json()["data"] == {"data_url": icon["data_url"]}
    reference = {"type": "image", "file_id": icon["file_id"]}
    notebook = client.post(
        "/notebooks", headers=owner, json={"title": "Image", "icon": reference}
    )
    assert notebook.status_code == 201, notebook.text
    assert notebook.json()["data"]["icon"] == reference
    existing = client.post(
        "/notebooks", headers=owner, json={"title": "Existing"}
    ).json()["data"]
    changed = client.patch(
        f"/notebooks/{existing['id']}", headers=owner, json={"icon": reference}
    )
    assert changed.status_code == 200
    assert changed.json()["data"]["icon"] == reference
    listed = client.get("/notebooks", headers=owner).json()["data"]["items"]
    assert listed[0]["icon"] == reference


@pytest.mark.parametrize(
    "contents,mime,expected_status,expected_code",
    [
        (b"not an image", "image/png", 422, "NOTEBOOK_ICON_INVALID_IMAGE"),
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            "image/svg+xml",
            422,
            "NOTEBOOK_ICON_INVALID_IMAGE",
        ),
        (image_bytes("GIF"), "image/gif", 422, "NOTEBOOK_ICON_INVALID_IMAGE"),
        (b"a" * (2 * 1024 * 1024 + 1), "image/png", 413, "NOTEBOOK_ICON_TOO_LARGE"),
        (
            image_bytes(size=(4097, 4096)),
            "image/png",
            422,
            "NOTEBOOK_ICON_INVALID_IMAGE",
        ),
    ],
    ids=["bad-bytes", "svg", "gif", "oversized-file", "oversized-pixels"],
)
def test_invalid_and_oversized_uploads_leave_no_files(
    client: TestClient,
    owner: dict[str, str],
    contents: bytes,
    mime: str,
    expected_status: int,
    expected_code: str,
):
    response = client.post(
        "/notebooks/icons", headers=owner, files={"file": ("icon.png", contents, mime)}
    )
    assert response.status_code == expected_status, response.text
    assert response.json()["code"] == expected_code
    assert client.get("/files", headers=owner).json()["data"]["items"] == []
    assert list(client.app.state.storage.root.rglob("*.webp")) == []


def test_arbitrary_files_and_foreign_workspace_icons_cannot_be_read_or_bound(
    client: TestClient, owner: dict[str, str]
):
    ordinary = client.post(
        "/files",
        headers=owner,
        files={"file": ("image.png", image_bytes(), "image/png")},
    ).json()["data"]
    foreign = upload_icon(client, owner)

    async def move_asset():
        async with client.app.state.session_factory() as session:
            asset = await session.get(FileAsset, UUID(foreign["file_id"]))
            asset.workspace_id = new_uuidv7()
            await session.commit()

    client.portal.call(move_asset)
    notebook = client.post("/notebooks", headers=owner, json={"title": "Local"}).json()[
        "data"
    ]
    for file_id in (ordinary["id"], foreign["file_id"], str(new_uuidv7())):
        icon = {"type": "image", "file_id": file_id}
        read = client.get(f"/notebooks/icons/{file_id}", headers=owner)
        assert read.status_code == 404
        assert read.json()["code"] == "NOTEBOOK_ICON_NOT_FOUND"
        created = client.post(
            "/notebooks", headers=owner, json={"title": "Invalid", "icon": icon}
        )
        assert created.status_code == 404
        assert created.json()["code"] == "NOTEBOOK_ICON_NOT_FOUND"
        updated = client.patch(
            f"/notebooks/{notebook['id']}", headers=owner, json={"icon": icon}
        )
        assert updated.status_code == 404
        assert updated.json()["code"] == "NOTEBOOK_ICON_NOT_FOUND"


def test_missing_icon_file_returns_not_found_without_breaking_notebook_listing(
    client: TestClient, owner: dict[str, str]
):
    uploaded = upload_icon(client, owner)
    reference = {"type": "image", "file_id": uploaded["file_id"]}
    created = client.post(
        "/notebooks", headers=owner, json={"title": "Custom", "icon": reference}
    )
    assert created.status_code == 201
    for path in client.app.state.storage.root.rglob("*.webp"):
        path.unlink()
    response = client.get(f"/notebooks/icons/{uploaded['file_id']}", headers=owner)
    assert response.status_code == 404
    assert response.json()["code"] == "NOTEBOOK_ICON_NOT_FOUND"
    assert (
        client.get("/notebooks", headers=owner).json()["data"]["items"][0]["icon"]
        == reference
    )


def test_read_only_members_can_read_but_cannot_upload_or_bind(
    client: TestClient, owner: dict[str, str]
):
    uploaded = upload_icon(client, owner)
    notebook = client.post(
        "/notebooks", headers=owner, json={"title": "Existing"}
    ).json()["data"]

    async def remove_write_permission():
        async with client.app.state.session_factory() as session:
            member = (await session.scalars(select(WorkspaceMember))).one()
            member.role = "normal"
            await session.commit()

    client.portal.call(remove_write_permission)
    assert (
        client.get(f"/notebooks/icons/{uploaded['file_id']}", headers=owner).status_code
        == 200
    )
    response = client.post(
        "/notebooks/icons",
        headers=owner,
        files={"file": ("image.png", image_bytes(), "image/png")},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "RESOURCE_MANAGEMENT_FORBIDDEN"
    response = client.patch(
        f"/notebooks/{notebook['id']}",
        headers=owner,
        json={"icon": {"type": "image", "file_id": uploaded["file_id"]}},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "RESOURCE_MANAGEMENT_FORBIDDEN"
    response = client.post(
        "/notebooks",
        headers=owner,
        json={
            "title": "Forbidden",
            "icon": {"type": "image", "file_id": uploaded["file_id"]},
        },
    )
    assert response.status_code == 403
    assert client.get(f"/notebooks/icons/{uploaded['file_id']}").status_code == 401


def test_icon_openapi_describes_types_limits_and_business_errors():
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    upload = schema["paths"]["/notebooks/icons"]["post"]
    assert "2 MiB" in upload["description"]
    assert (
        "NOTEBOOK_ICON_TOO_LARGE"
        in upload["responses"]["413"]["content"]["application/json"]["examples"]
    )
    assert (
        "NOTEBOOK_ICON_INVALID_IMAGE"
        in upload["responses"]["422"]["content"]["application/json"]["examples"]
    )
    assert "icon" in schema["components"]["schemas"]["NotebookOut"]["properties"]
