"""Deploy immutable releases with Compose and retain the last healthy release."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

RELEASE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}\Z")
IMAGE_DIGEST = re.compile(r"[^\s]+@sha256:[a-f0-9]{64}\Z")
COMMIT_ID = re.compile(r"[a-f0-9]{40}\Z")
DEFAULT_PROJECT = "orbis-app"
DEFAULT_PORT = 28190
DEFAULT_TIMEOUT = 180


def validate_manifest(value: dict) -> dict:
    if value.get("schema_version") != 1:
        raise ValueError("Unsupported release manifest schema")
    if not RELEASE_ID.fullmatch(value.get("release_id", "")):
        raise ValueError("Invalid release identifier")
    if not COMMIT_ID.fullmatch(value.get("commit", "")):
        raise ValueError("Release must name a complete Git commit")
    images = value.get("images", {})
    if set(images) != {"api", "web"} or any(
        not IMAGE_DIGEST.fullmatch(images[name]) for name in images
    ):
        raise ValueError("Both API and web images must use immutable digests")
    if value.get("database_contract") != "orbis-base-mvp-v1":
        raise ValueError("Database compatibility requires a reviewed release contract")
    return value


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, path)


def read_state(runtime: Path) -> dict:
    path = runtime / "state.json"
    return json.loads(path.read_text()) if path.exists() else {}


def publish_compose_entrypoint(runtime: Path, manifest: dict) -> None:
    source = runtime / "releases" / manifest["release_id"] / "compose.yaml"
    temporary = runtime / "docker-compose.yml.tmp"
    shutil.copyfile(source, temporary)
    os.replace(temporary, runtime / "docker-compose.yml")
    image_env = runtime / "images.env.tmp"
    image_env.write_text(
        f"ORBIS_API_IMAGE={manifest['images']['api']}\n"
        f"ORBIS_WEB_IMAGE={manifest['images']['web']}\n"
    )
    os.replace(image_env, runtime / "images.env")


def read_env(runtime: Path) -> dict[str, str]:
    values = {}
    for line in (runtime / ".env").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip("\"'")
    return values


def initialize_runtime(runtime: Path, public_url: str) -> None:
    runtime.mkdir(parents=True, exist_ok=True)
    for name in ["data/postgres", "data/api", "releases"]:
        (runtime / name).mkdir(parents=True, exist_ok=True)
    env_path = runtime / ".env"
    if not env_path.exists():
        values = {
            "ORBIS_UID": str(os.getuid()),
            "ORBIS_GID": str(os.getgid()),
            "ORBIS_PORT": str(DEFAULT_PORT),
            "ORBIS_BIND_ADDRESS": "0.0.0.0",
            "ORBIS_PUBLIC_URL": public_url,
            "ORBIS_DATABASE_PASSWORD": secrets.token_hex(32),
            "ORBIS_ACCESS_TOKEN_SECRET": secrets.token_urlsafe(48),
            "ORBIS_REFRESH_TOKEN_SECRET": secrets.token_urlsafe(48),
            "ORBIS_ACTION_TOKEN_SECRET": secrets.token_urlsafe(48),
        }
        with env_path.open("x") as handle:
            os.chmod(env_path, 0o600)
            handle.write("".join(f"{key}={value}\n" for key, value in values.items()))


@contextlib.contextmanager
def release_lock(runtime: Path):
    with (runtime / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another deployment is already running") from error
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def compose_command(runtime: Path, project: str, release: dict) -> list[str]:
    config = runtime / "releases" / release["release_id"] / "compose.yaml"
    return [
        "docker",
        "compose",
        "--project-directory",
        str(runtime),
        "--env-file",
        str(runtime / ".env"),
        "-p",
        project,
        "-f",
        str(config),
    ]


def compose_env(release: dict) -> dict[str, str]:
    return {
        **os.environ,
        "ORBIS_API_IMAGE": release["images"]["api"],
        "ORBIS_WEB_IMAGE": release["images"]["web"],
    }


def smoke(base_url: str) -> None:
    with urllib.request.urlopen(base_url + "/api/healthz", timeout=10) as response:
        if json.load(response).get("data", {}).get("status") != "ok":
            raise RuntimeError("API health check did not return the expected response")
    with urllib.request.urlopen(base_url + "/api/openapi.json", timeout=10) as response:
        if "/setup" not in json.load(response).get("paths", {}):
            raise RuntimeError("API contract is unavailable")
    with urllib.request.urlopen(base_url + "/api/docs", timeout=10) as response:
        docs = response.read().decode()
    schema_urls = re.findall(r"url: ['\"]([^'\"]+)", docs)
    if not schema_urls:
        raise RuntimeError("API documentation schema link is missing")
    with urllib.request.urlopen(base_url + schema_urls[0], timeout=10) as response:
        if "/setup" not in json.load(response).get("paths", {}):
            raise RuntimeError("API documentation schema link is unavailable")
    with urllib.request.urlopen(base_url + "/setup", timeout=10) as response:
        html = response.read().decode()
    scripts = re.findall(r'src="([^"]+\.js)"', html)
    if not scripts:
        raise RuntimeError("Frontend entry script is missing")
    with urllib.request.urlopen(base_url + scripts[0], timeout=10) as response:
        if response.status != 200 or not response.read(1):
            raise RuntimeError("Frontend entry script is unavailable")


def apply_release(runtime: Path, project: str, release: dict, timeout: int) -> None:
    command = compose_command(runtime, project, release)
    env = compose_env(release)
    subprocess.run(command + ["config", "--quiet"], env=env, check=True)
    subprocess.run(command + ["pull"], env=env, check=True, timeout=600)
    subprocess.run(
        command + ["up", "-d", "--wait", "--wait-timeout", str(timeout)],
        env=env,
        check=True,
        timeout=timeout + 30,
    )
    port = int(read_env(runtime)["ORBIS_PORT"])
    host = os.environ.get("ORBIS_SMOKE_HOST", "127.0.0.1")
    smoke(f"http://{host}:{port}")
    schema = subprocess.check_output(
        command
        + [
            "exec",
            "-T",
            "db",
            "psql",
            "-U",
            "orbis",
            "-d",
            "orbis",
            "-Atc",
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
        ],
        env=env,
        text=True,
    ).strip()
    if not schema.isdigit() or int(schema) == 0:
        raise RuntimeError("Application database tables are unavailable")


def load_release(runtime: Path, release_id: str) -> dict:
    if not RELEASE_ID.fullmatch(release_id):
        raise ValueError("Invalid release identifier")
    return validate_manifest(
        json.loads((runtime / "releases" / release_id / "manifest.json").read_text())
    )


def deploy(runtime: Path, manifest_path: Path, template: Path, project: str, timeout: int) -> None:
    manifest = validate_manifest(json.loads(manifest_path.read_text()))
    with release_lock(runtime):
        state = read_state(runtime)
        previous_id = state.get("current")
        release_dir = runtime / "releases" / manifest["release_id"]
        if release_dir.exists():
            if load_release(runtime, manifest["release_id"]) != manifest:
                raise ValueError("A release identifier cannot be reused for different artifacts")
        else:
            release_dir.mkdir()
            shutil.copyfile(template, release_dir / "compose.yaml")
            write_json(release_dir / "manifest.json", manifest)
        try:
            apply_release(runtime, project, manifest, timeout)
        except Exception:
            write_json(release_dir / "failed.json", {"failed_at": int(time.time())})
            if previous_id:
                print(f"Deployment failed; restoring {previous_id}", flush=True)
                previous = load_release(runtime, previous_id)
                if previous["database_contract"] != manifest["database_contract"]:
                    raise RuntimeError("Automatic rollback requires database compatibility")
                apply_release(runtime, project, previous, timeout)
            raise
        publish_compose_entrypoint(runtime, manifest)
        write_json(
            runtime / "state.json",
            {
                "current": manifest["release_id"],
                "previous": previous_id
                if previous_id != manifest["release_id"]
                else state.get("previous"),
                "deployed_at": int(time.time()),
                "project": project,
            },
        )
        print(f"Deployed {manifest['release_id']}", flush=True)


def rollback(runtime: Path, release_id: str | None, project: str, timeout: int) -> None:
    with release_lock(runtime):
        state = read_state(runtime)
        target = release_id or state.get("previous")
        if not target:
            raise ValueError("No previous successful release is available")
        release = load_release(runtime, target)
        apply_release(runtime, project, release, timeout)
        if target == state.get("current"):
            print(f"Release {target} is already current; health verified", flush=True)
            return
        publish_compose_entrypoint(runtime, release)
        write_json(
            runtime / "state.json",
            {
                "current": target,
                "previous": state.get("current"),
                "deployed_at": int(time.time()),
                "project": project,
            },
        )
        print(f"Restored {target}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["init", "deploy", "rollback", "status"])
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--template", type=Path, default=Path("deploy/compose.yaml"))
    parser.add_argument("--release-id")
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--public-url", default=f"http://10.0.0.223:{DEFAULT_PORT}")
    args = parser.parse_args()
    runtime = args.runtime_dir.resolve()
    if args.action == "init":
        initialize_runtime(runtime, args.public_url)
    elif args.action == "deploy":
        if args.manifest is None:
            parser.error("deploy requires --manifest")
        deploy(runtime, args.manifest, args.template, args.project, args.timeout)
    elif args.action == "rollback":
        rollback(runtime, args.release_id, args.project, args.timeout)
    else:
        print(json.dumps(read_state(runtime), indent=2))


if __name__ == "__main__":
    main()
