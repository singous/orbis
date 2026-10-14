import json
from pathlib import Path

import pytest

from ci import registry, release


def test_transport_preserves_the_repository_and_digest():
    image = "hub.poflow.cn/orbis/backend@sha256:" + "a" * 64
    assert registry.transport_image(image, "hub.poflow.cn", "127.0.0.1:28182") == (
        "127.0.0.1:28182/orbis/backend@sha256:" + "a" * 64
    )
    assert registry.transport_image(image, "other.example", "127.0.0.1:28182") == image


@pytest.mark.parametrize(
    "invalid", ["https://hub.example", "hub.example/project", "host:0", "host:65536"]
)
def test_invalid_registry_addresses_are_rejected(invalid):
    with pytest.raises(ValueError):
        registry.validate_address(invalid)


def test_robot_secret_uses_stdin_and_temporary_config_is_removed(tmp_path, monkeypatch):
    monkeypatch.setenv("ORBIS_REGISTRY_USERNAME", "robot-test")
    monkeypatch.setenv("ORBIS_REGISTRY_PASSWORD", "test-secret")
    calls = []
    monkeypatch.setattr(
        registry.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs))
    )
    with registry.authenticated("hub.example", "127.0.0.1:28182") as environment:
        directory = Path(environment["DOCKER_CONFIG"])
        assert directory.is_dir()
        assert "ORBIS_REGISTRY_PASSWORD" not in environment
        assert len(calls) == 2
        for args, kwargs in calls:
            assert "test-secret" not in args[0]
            assert kwargs["input"] == "test-secret\n"
            assert kwargs["env"]["DOCKER_CONFIG"] == str(directory)
    assert not directory.exists()


def test_failed_login_removes_the_temporary_config(monkeypatch):
    monkeypatch.setenv("ORBIS_REGISTRY_USERNAME", "robot-test")
    monkeypatch.setenv("ORBIS_REGISTRY_PASSWORD", "test-secret")
    directories = []

    def fail(*args, **kwargs):
        directories.append(Path(kwargs["env"]["DOCKER_CONFIG"]))
        raise RuntimeError("Registry unavailable")

    monkeypatch.setattr(registry.subprocess, "run", fail)
    with (
        pytest.raises(RuntimeError, match="Registry unavailable"),
        registry.authenticated("hub.example"),
    ):
        pytest.fail("Authentication succeeded")
    assert directories and not directories[0].exists()


def test_deployment_prefetches_only_images_in_the_configured_registry(monkeypatch):
    calls = []
    monkeypatch.setattr(registry.subprocess, "run", lambda *args, **kwargs: calls.append(args[0]))
    registry.prefetch(
        ["hub.example/orbis/backend@sha256:" + "a" * 64, "postgres:16"],
        "hub.example",
        "127.0.0.1:28182",
        {},
    )
    assert calls == [["docker", "pull", "127.0.0.1:28182/orbis/backend@sha256:" + "a" * 64]]


def test_registry_migration_keeps_original_release_records(tmp_path):
    original = "old.example/orbis/backend@sha256:" + "a" * 64
    target = "hub.example/orbis/backend@sha256:" + "a" * 64
    value = {"images": {"api": original, "web": original}}
    (tmp_path / "registry-migration.json").write_text(json.dumps({"images": {original: target}}))
    assert release.resolve_registry_images(tmp_path, value)["images"] == {
        "api": target,
        "web": target,
    }
    assert value["images"] == {"api": original, "web": original}


def test_registry_migration_cannot_change_image_contents(tmp_path):
    original = "old.example/orbis/backend@sha256:" + "a" * 64
    target = "hub.example/orbis/backend@sha256:" + "b" * 64
    (tmp_path / "registry-migration.json").write_text(json.dumps({"images": {original: target}}))
    with pytest.raises(ValueError, match="preserve"):
        release.resolve_registry_images(tmp_path, {"images": {"api": original}})


def test_standalone_deployment_uses_the_pull_config_without_logging_in(monkeypatch):
    monkeypatch.delenv("ORBIS_REGISTRY_USERNAME", raising=False)
    monkeypatch.delenv("ORBIS_REGISTRY_PASSWORD", raising=False)
    monkeypatch.setattr(
        registry.subprocess, "run", lambda *args, **kwargs: pytest.fail("Unexpected login")
    )
    with registry.authenticated(
        "hub.example", docker_config="/protected/pull-config"
    ) as environment:
        assert environment["DOCKER_CONFIG"] == "/protected/pull-config"


def test_rollback_entrypoint_uses_migrated_images_without_rewriting_the_manifest(tmp_path):
    original = "old.example/orbis/backend@sha256:" + "a" * 64
    target = "hub.example/orbis/backend@sha256:" + "a" * 64
    value = {"release_id": "release-1", "images": {"api": original, "web": original}}
    directory = tmp_path / "releases/release-1"
    directory.mkdir(parents=True)
    (directory / "compose.yaml").write_text("services: {}\n")
    serialized = json.dumps(value)
    (directory / "manifest.json").write_text(serialized)
    (tmp_path / "registry-migration.json").write_text(json.dumps({"images": {original: target}}))
    release.publish_compose_entrypoint(tmp_path, value)
    assert (tmp_path / "images.env").read_text().count(target) == 2
    assert (directory / "manifest.json").read_text() == serialized
