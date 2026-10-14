import json

import pytest

from ci import release


def manifest(name="release-1"):
    return {
        "schema_version": 1,
        "release_id": name,
        "commit": "a" * 40,
        "database_contract": "orbis-base-mvp-v1",
        "images": {
            "api": "localhost/api@sha256:" + "a" * 64,
            "web": "localhost/web@sha256:" + "b" * 64,
        },
    }


@pytest.mark.parametrize("invalid", ["../escape", "/absolute", "", "release/one"])
def test_reject_release_path_traversal(invalid):
    with pytest.raises(ValueError):
        release.validate_manifest(manifest(invalid))


def test_mutable_image_tags_are_rejected():
    value = manifest()
    value["images"]["api"] = "localhost/api:latest"
    with pytest.raises(ValueError):
        release.validate_manifest(value)


def test_failed_deployment_restores_previous_without_advancing_state(tmp_path, monkeypatch):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    old = tmp_path / "releases/release-1"
    old.mkdir()
    release.write_json(old / "manifest.json", manifest())
    release.write_json(tmp_path / "state.json", {"current": "release-1"})
    source = tmp_path / "new.json"
    source.write_text(json.dumps(manifest("release-2")))
    template = tmp_path / "template.yaml"
    template.write_text("services: {}\n")
    calls = []

    def apply(runtime, project, value, timeout):
        calls.append(value["release_id"])
        if value["release_id"] == "release-2":
            raise RuntimeError("Deployment probe failed")

    monkeypatch.setattr(release, "apply_release", apply)
    with pytest.raises(RuntimeError, match="probe failed"):
        release.deploy(tmp_path, source, template, "orbis-test", 5)
    assert calls == ["release-2", "release-1"]
    assert release.read_state(tmp_path)["current"] == "release-1"
    assert (tmp_path / "releases/release-2/failed.json").exists()


def test_runtime_initialization_preserves_secrets(tmp_path):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    original = (tmp_path / ".env").read_bytes()
    release.initialize_runtime(tmp_path, "http://localhost:9999")
    assert (tmp_path / ".env").read_bytes() == original


def test_repeated_rollback_preserves_previous_release(tmp_path, monkeypatch):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    current = tmp_path / "releases/release-2"
    current.mkdir()
    release.write_json(current / "manifest.json", manifest("release-2"))
    release.write_json(tmp_path / "state.json", {"current": "release-2", "previous": "release-1"})
    original = (tmp_path / "state.json").read_bytes()
    monkeypatch.setattr(release, "apply_release", lambda *args: None)
    release.rollback(tmp_path, "release-2", "orbis-test", 5)
    assert (tmp_path / "state.json").read_bytes() == original


def test_concurrent_deployment_is_rejected(tmp_path):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    with (
        release.release_lock(tmp_path),
        pytest.raises(RuntimeError, match="already running"),
        release.release_lock(tmp_path),
    ):
        pytest.fail("Second deployment acquired the lock")


def test_agent_smoke_uses_the_host_gateway(tmp_path, monkeypatch):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    monkeypatch.setenv("ORBIS_SMOKE_HOST", "host.docker.internal")
    monkeypatch.setattr(release.subprocess, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(release.subprocess, "check_output", lambda *args, **kwargs: "1\n")
    addresses = []
    monkeypatch.setattr(release, "smoke", addresses.append)
    release.apply_release(tmp_path, "orbis-test", manifest(), 5)
    assert addresses == ["http://host.docker.internal:28190"]


def test_failed_manual_rollback_restores_the_active_version(tmp_path, monkeypatch):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    for name in ["release-1", "release-2"]:
        folder = tmp_path / "releases" / name
        folder.mkdir()
        release.write_json(folder / "manifest.json", manifest(name))
    release.write_json(tmp_path / "state.json", {"current": "release-2", "previous": "release-1"})
    original = (tmp_path / "state.json").read_bytes()
    calls = []

    def apply(runtime, project, value, timeout):
        calls.append(value["release_id"])
        if value["release_id"] == "release-1":
            raise RuntimeError("Rollback target failed its health check")

    monkeypatch.setattr(release, "apply_release", apply)
    with pytest.raises(RuntimeError, match="target failed"):
        release.rollback(tmp_path, "release-1", "orbis-test", 5)
    assert calls == ["release-1", "release-2"]
    assert (tmp_path / "state.json").read_bytes() == original
