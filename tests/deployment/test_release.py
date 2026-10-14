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


def test_concurrent_deployment_is_rejected(tmp_path):
    release.initialize_runtime(tmp_path, "http://localhost:28190")
    with (
        release.release_lock(tmp_path),
        pytest.raises(RuntimeError, match="already running"),
        release.release_lock(tmp_path),
    ):
        pytest.fail("Second deployment acquired the lock")
