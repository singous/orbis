"""Build tested component images and publish them to the configured registry."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path

from release import RELEASE_ID, validate_manifest, write_json


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def component(name: str, release_id: str, registry: str, artifact_root: Path) -> None:
    if not RELEASE_ID.fullmatch(release_id):
        raise ValueError("Invalid release identifier")
    if not re.fullmatch(r"[a-zA-Z0-9.:-]+", registry):
        raise ValueError("Invalid registry address")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    artifacts = Path("artifacts")
    artifacts.mkdir(exist_ok=True)
    reports = artifacts / "reports"
    reports.mkdir(exist_ok=True)
    test_image = f"orbis/{name}-test:{release_id}"
    run(
        "docker",
        "build",
        "-f",
        "docker/orbis.Dockerfile",
        "--target",
        name + "-test",
        "-t",
        test_image,
        ".",
    )
    test_command = [
        "docker",
        "run",
        "--rm",
        "--cpus=2",
        "--memory=4g",
        "--shm-size=256m",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--mount",
        f"type=bind,src={reports.resolve()},dst=/reports",
    ]
    if name == "backend":
        test_command += [
            test_image,
            "python",
            "-m",
            "pytest",
            "-q",
            "tests",
            "../orbis-cli/tests",
            "../tests/deployment",
            "-o",
            "cache_dir=/tmp/pytest-cache",
            "--junitxml=/reports/backend.xml",
        ]
    else:
        test_command += [
            test_image,
            "npm",
            "run",
            "test:run",
            "--",
            "--maxWorkers=2",
            "--minWorkers=1",
            "--reporter=default",
            "--reporter=junit",
            "--outputFile.junit=/reports/frontend.xml",
        ]
    run(*test_command)
    target = "backend" if name == "backend" else "frontend"
    image = f"{registry}/orbis/{name}:{release_id}"
    run(
        "docker",
        "build",
        "-f",
        "docker/orbis.Dockerfile",
        "--target",
        target,
        "--label",
        f"org.opencontainers.image.revision={revision}",
        "--label",
        f"org.opencontainers.image.version={release_id}",
        "-t",
        image,
        ".",
    )
    run("docker", "push", image)
    details = json.loads(subprocess.check_output(["docker", "image", "inspect", image], text=True))[
        0
    ]
    repository = image.rsplit(":", 1)[0]
    digest = next(item for item in details["RepoDigests"] if item.startswith(repository + "@"))
    metadata = {"component": name, "release_id": release_id, "commit": revision, "image": digest}
    write_json(artifacts / f"{name}.json", metadata)
    destination = artifact_root / release_id
    destination.mkdir(parents=True, exist_ok=True)
    write_json(destination / f"{name}.json", metadata)
    print(json.dumps(metadata, indent=2))


def assemble(release_id: str, artifact_root: Path) -> None:
    if not RELEASE_ID.fullmatch(release_id):
        raise ValueError("Invalid release identifier")
    components = {
        name: json.loads((artifact_root / release_id / f"{name}.json").read_text())
        for name in ["backend", "frontend"]
    }
    if any(item["release_id"] != release_id for item in components.values()):
        raise ValueError("Component releases do not match")
    if components["backend"]["commit"] != components["frontend"]["commit"]:
        raise ValueError("Both components must be built from the same commit")
    manifest = validate_manifest(
        {
            "schema_version": 1,
            "release_id": release_id,
            "commit": components["backend"]["commit"],
            "created_at": int(time.time()),
            "database_contract": "orbis-base-mvp-v1",
            "images": {
                "api": components["backend"]["image"],
                "web": components["frontend"]["image"],
            },
        }
    )
    Path("artifacts").mkdir(exist_ok=True)
    write_json(Path("artifacts/release.json"), manifest)
    write_json(artifact_root / release_id / "release.json", manifest)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["backend", "frontend", "assemble"])
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--registry", default=os.environ.get("ORBIS_REGISTRY", "127.0.0.1:28210"))
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=Path(os.environ.get("ORBIS_ARTIFACT_ROOT", "artifacts/releases")),
    )
    args = parser.parse_args()
    if args.action == "assemble":
        assemble(args.release_id, args.artifact_root)
    else:
        component(args.action, args.release_id, args.registry, args.artifact_root)


if __name__ == "__main__":
    main()
