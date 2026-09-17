from __future__ import annotations

import asyncio
import os
import threading
from dataclasses import FrozenInstanceError
from hashlib import sha256
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.responses import FileResponse
from fastapi.testclient import TestClient
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv(
        "ORBIS_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'assets.db'}"
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
def uploaded(client: TestClient) -> tuple[dict[str, object], UUID]:
    setup = client.post(
        "/setup",
        json={
            "email": "owner@example.com",
            "password": PASSWORD,
            "display_name": "Owner",
        },
    )
    assert setup.status_code == 201, setup.text
    payload = setup.json()["data"]
    headers = {"Authorization": f"Bearer {payload['access_token']}"}
    response = client.post(
        "/files",
        headers=headers,
        files={"file": ("diagram.png", b"immutable asset bytes", "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"], UUID(payload["workspace"]["id"])


def test_internal_file_references_are_canonical_and_strict() -> None:
    from orbis_user_api.application.site_assets import (
        file_reference,
        parse_file_reference,
    )

    file_id = UUID("019fe1e0-1234-7abc-8def-0123456789ab")
    reference = file_reference(file_id)

    assert reference == "orbis-file:019fe1e0-1234-7abc-8def-0123456789ab"
    assert parse_file_reference(reference) == file_id
    assert parse_file_reference(reference.upper()) is None
    assert parse_file_reference(f" {reference}") is None
    assert parse_file_reference(f"{reference}/content") is None
    assert parse_file_reference("https://example.com/file.png") is None
    assert parse_file_reference("orbis-file:not-a-uuid") is None


def test_prepare_public_asset_copies_verified_bytes_without_mutating_original(
    client: TestClient, uploaded: tuple[dict[str, object], UUID]
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded
    expected_key = sha256(b"immutable asset bytes").hexdigest()
    original = client.app.state.storage.resolve(str(file_data["storage_key"]))
    original_stat = original.stat()

    async def prepare():
        async with client.app.state.session_factory() as session:
            return await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )

    asset = client.portal.call(prepare)
    public_copy = client.app.state.storage.root / "public-assets" / expected_key

    assert asset.key == expected_key
    assert asset.filename == "diagram.png"
    assert asset.media_type == "image/png"
    assert asset.size == len(b"immutable asset bytes")
    assert asset.as_dict() == {
        "key": expected_key,
        "filename": "diagram.png",
        "media_type": "image/png",
        "size": len(b"immutable asset bytes"),
    }
    assert set(asset.as_dict()) == {"key", "filename", "media_type", "size"}
    assert public_copy.read_bytes() == b"immutable asset bytes"
    assert original.read_bytes() == b"immutable asset bytes"
    assert original.stat().st_ino == original_stat.st_ino
    with pytest.raises(FrozenInstanceError):
        asset.filename = "changed.png"  # type: ignore[misc]


def test_prepare_public_asset_reuses_same_verified_hash_copy(
    client: TestClient, uploaded: tuple[dict[str, object], UUID]
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded

    async def prepare_twice():
        async with client.app.state.session_factory() as session:
            first = await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )
            path = client.app.state.storage.root / "public-assets" / first.key
            first_inode = path.stat().st_ino
            second = await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )
            return first, second, first_inode, path.stat().st_ino

    first, second, first_inode, second_inode = client.portal.call(prepare_twice)

    assert first == second
    assert first_inode == second_inode
    assert len(list((client.app.state.storage.root / "public-assets").iterdir())) == 1


def test_concurrent_first_publications_create_one_shared_directory(
    client: TestClient,
    uploaded: tuple[dict[str, object], UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded
    storage = client.app.state.storage
    public_root = storage.root.resolve() / "public-assets"
    missing_directory_barrier = threading.Barrier(2, timeout=5)
    original_lstat = Path.lstat

    def synchronized_lstat(path: Path):
        try:
            return original_lstat(path)
        except FileNotFoundError:
            if path == public_root:
                missing_directory_barrier.wait()
            raise

    monkeypatch.setattr(Path, "lstat", synchronized_lstat)

    async def prepare_twice():
        async def prepare_once():
            async with client.app.state.session_factory() as session:
                return await prepare_public_asset(
                    UUID(str(file_data["id"])),
                    workspace_id,
                    session,
                    storage,
                )

        return await asyncio.gather(prepare_once(), prepare_once())

    first, second = client.portal.call(prepare_twice)

    assert first == second
    assert (public_root / first.key).read_bytes() == b"immutable asset bytes"


def test_concurrent_same_content_reuse_waits_for_atomic_copy_completion(
    client: TestClient,
    uploaded: tuple[dict[str, object], UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from orbis_user_api.application import site_assets

    file_data, workspace_id = uploaded
    storage = client.app.state.storage
    (storage.root.resolve() / "public-assets").mkdir()
    first_link_created = threading.Event()
    validation_started = threading.Event()
    allow_validation = threading.Event()
    validation_finished = threading.Event()
    original_link = site_assets.os.link
    original_validate = site_assets._validate_public_copy

    def synchronized_link(source: Path, destination: Path):
        try:
            result = original_link(source, destination)
        except FileExistsError:
            assert first_link_created.wait(timeout=5)
            raise
        first_link_created.set()
        if validation_started.wait(timeout=1):
            allow_validation.set()
            assert validation_finished.wait(timeout=5)
        else:
            allow_validation.set()
        return result

    def synchronized_validation(*args, **kwargs):
        validation_started.set()
        assert allow_validation.wait(timeout=5)
        try:
            return original_validate(*args, **kwargs)
        finally:
            validation_finished.set()

    monkeypatch.setattr(site_assets.os, "link", synchronized_link)
    monkeypatch.setattr(site_assets, "_validate_public_copy", synchronized_validation)

    async def prepare_twice():
        async def prepare_once():
            async with client.app.state.session_factory() as session:
                return await site_assets.prepare_public_asset(
                    UUID(str(file_data["id"])),
                    workspace_id,
                    session,
                    storage,
                )

        return await asyncio.gather(prepare_once(), prepare_once())

    first, second = client.portal.call(prepare_twice)

    assert first == second
    public_copy = storage.root.resolve() / "public-assets" / first.key
    assert public_copy.stat().st_nlink == 1
    assert public_copy.read_bytes() == b"immutable asset bytes"


@pytest.mark.parametrize(
    "alias_type", ["destination-symlink", "parent-symlink", "hardlink"]
)
def test_prepare_public_asset_rejects_preexisting_publication_aliases(
    client: TestClient,
    uploaded: tuple[dict[str, object], UUID],
    alias_type: str,
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded
    storage = client.app.state.storage
    source = storage.resolve(str(file_data["storage_key"]))
    public_root = storage.root.resolve() / "public-assets"
    expected_key = sha256(b"immutable asset bytes").hexdigest()
    if alias_type == "parent-symlink":
        outside_public_root = storage.root.resolve() / "attacker-public-assets"
        outside_public_root.mkdir()
        public_root.symlink_to(outside_public_root, target_is_directory=True)
    else:
        public_root.mkdir()
        destination = public_root / expected_key
        if alias_type == "destination-symlink":
            destination.symlink_to(source)
        else:
            os.link(source, destination)

    async def prepare() -> None:
        async with client.app.state.session_factory() as session:
            await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                storage,
            )

    with pytest.raises(SiteError) as error:
        client.portal.call(prepare)

    assert error.value.code == "SITE_ASSET_CORRUPT"
    assert source.read_bytes() == b"immutable asset bytes"
    if alias_type == "parent-symlink":
        assert list((storage.root.resolve() / "attacker-public-assets").iterdir()) == []
    elif alias_type == "destination-symlink":
        assert (public_root / expected_key).is_symlink()
    else:
        assert os.path.samefile(source, public_root / expected_key)


@pytest.mark.parametrize("tampering", ["contents", "stored-size", "stored-sha"])
def test_prepare_public_asset_rejects_source_or_metadata_tampering(
    client: TestClient,
    uploaded: tuple[dict[str, object], UUID],
    tampering: str,
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded
    source = client.app.state.storage.resolve(str(file_data["storage_key"]))
    if tampering == "contents":
        source.write_bytes(b"tampered asset bytes!")

    async def prepare() -> None:
        async with client.app.state.session_factory() as session:
            if tampering != "contents":
                record = await session.get(FileAsset, UUID(str(file_data["id"])))
                assert record is not None
                if tampering == "stored-size":
                    record.file_size += 1
                else:
                    record.sha256 = "0" * 64
                await session.commit()
            await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )

    with pytest.raises(SiteError) as error:
        client.portal.call(prepare)

    assert error.value.code == "SITE_ASSET_CHANGED"
    assert source.read_bytes() == (
        b"tampered asset bytes!"
        if tampering == "contents"
        else b"immutable asset bytes"
    )
    public_root = client.app.state.storage.root / "public-assets"
    assert not public_root.exists() or list(public_root.iterdir()) == []


@pytest.mark.parametrize("unavailable", ["foreign", "incomplete", "missing"])
def test_prepare_public_asset_rejects_unavailable_sources(
    client: TestClient,
    uploaded: tuple[dict[str, object], UUID],
    unavailable: str,
) -> None:
    from orbis_user_api.application.site_assets import prepare_public_asset

    file_data, workspace_id = uploaded

    async def prepare() -> None:
        async with client.app.state.session_factory() as session:
            file_id = UUID(str(file_data["id"]))
            if unavailable == "missing":
                file_id = new_uuidv7()
            else:
                record = await session.get(FileAsset, file_id)
                assert record is not None
                if unavailable == "foreign":
                    record.workspace_id = new_uuidv7()
                else:
                    record.upload_status = "processing"
                await session.commit()
            await prepare_public_asset(
                file_id,
                workspace_id,
                session,
                client.app.state.storage,
            )

    with pytest.raises(SiteError) as error:
        client.portal.call(prepare)

    assert error.value.code == "SITE_ASSET_NOT_FOUND"


def test_public_asset_response_retains_file_streaming_headers(
    client: TestClient, uploaded: tuple[dict[str, object], UUID]
) -> None:
    from orbis_user_api.application.site_assets import (
        prepare_public_asset,
        public_asset_response,
    )

    file_data, workspace_id = uploaded

    async def prepare():
        async with client.app.state.session_factory() as session:
            return await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )

    asset = client.portal.call(prepare)
    response = public_asset_response(asset, client.app.state.storage)

    assert isinstance(response, FileResponse)
    assert response.media_type == "image/png"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_public_asset_response_rejects_same_size_corruption(
    client: TestClient, uploaded: tuple[dict[str, object], UUID]
) -> None:
    from orbis_user_api.application.site_assets import (
        prepare_public_asset,
        public_asset_response,
    )

    file_data, workspace_id = uploaded

    async def prepare():
        async with client.app.state.session_factory() as session:
            return await prepare_public_asset(
                UUID(str(file_data["id"])),
                workspace_id,
                session,
                client.app.state.storage,
            )

    asset = client.portal.call(prepare)
    public_copy = client.app.state.storage.root / "public-assets" / asset.key
    public_copy.chmod(0o644)
    public_copy.write_bytes(b"x" * asset.size)

    with pytest.raises(SiteError) as error:
        public_asset_response(asset, client.app.state.storage)

    assert error.value.code == "SITE_ASSET_CORRUPT"


def test_public_asset_response_does_not_authorize_missing_assets(
    client: TestClient,
) -> None:
    from orbis_user_api.application.site_assets import (
        PublishedAsset,
        public_asset_response,
    )

    asset = PublishedAsset(
        key="0" * 64,
        filename="missing.png",
        media_type="image/png",
        size=10,
    )

    with pytest.raises(SiteError) as error:
        public_asset_response(asset, client.app.state.storage)

    assert error.value.code == "SITE_ASSET_CORRUPT"
