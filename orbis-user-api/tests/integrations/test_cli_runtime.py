"""Acceptance through the installed console script and a real HTTP server."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4

import pytest


@pytest.mark.skipif(
    shutil.which("orbis") is None,
    reason="Install orbis-cli to run installed-console acceptance",
)
def test_installed_cli_uses_real_remote_http_from_another_directory(
    tmp_path, monkeypatch
):
    root = Path(__file__).resolve().parents[2]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    server_env = dict(
        os.environ,
        ORBIS_DATABASE_URL=f"sqlite+aiosqlite:///{tmp_path / 'runtime.db'}",
        ORBIS_STORAGE_DIR=str(tmp_path / "assets"),
        ORBIS_AUTO_CREATE_TABLES="true",
        ORBIS_ACTION_TOKEN_SECRET="runtime-isolated-action-secret-at-least-32-bytes",
        ORBIS_ACCESS_TOKEN_SECRET="runtime-isolated-access-secret-at-least-32-bytes",
        ORBIS_REFRESH_TOKEN_SECRET="runtime-isolated-refresh-secret-at-least-32-bytes",
        PYTHONPATH=str(root / "src"),
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "orbis_user_api.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=tmp_path,
        env=server_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    def api(path, body=None, headers=None):
        request = Request(
            base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", **(headers or {})},
            method="POST" if body is not None else "GET",
        )
        with build_opener(ProxyHandler({})).open(request, timeout=10) as response:
            return json.load(response)["data"]

    try:
        for _ in range(100):
            try:
                api("/healthz")
                break
            except OSError:
                if process.poll() is not None:
                    pytest.fail(
                        "Isolated runtime server exited before accepting connections"
                    )
                time.sleep(0.05)
        else:
            pytest.fail("Isolated runtime server did not become healthy")
        auth = api(
            "/setup",
            {
                "email": "runtime@example.com",
                "password": "Runtime-Isolated-2026!",
                "display_name": "CLI Runtime",
            },
        )
        jwt = {"Authorization": "Bearer " + auth["access_token"]}
        workspace = api("/workspaces", headers=jwt)["items"][0]["id"]
        jwt["X-Workspace-ID"] = workspace
        notebook = api("/notebooks", {"title": "Remote CLI library"}, jwt)
        token = api(
            "/integrations/tokens",
            {
                "name": "Runtime CLI",
                "permissions": [
                    "notes:read",
                    "notes:write",
                    "files:read",
                    "files:write",
                    "shares:manage",
                ],
                "notebook_id": notebook["id"],
            },
            jwt,
        )
        env = dict(
            os.environ,
            ORBIS_TOKEN=token["token"],
            ORBIS_BASE_URL=base,
            ORBIS_WORKSPACE_ID=workspace,
            ORBIS_CONFIG_DIR=str(tmp_path / "profiles"),
        )

        def run(*arguments):
            command = [shutil.which("orbis"), "--json", "--allow-http", *arguments]
            result = subprocess.run(
                command,
                cwd=tmp_path,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            assert token["token"] not in result.stdout + result.stderr
            assert result.returncode == 0, result.stdout + result.stderr
            return json.loads(result.stdout)["data"]

        help_result = subprocess.run(
            [shutil.which("orbis"), "--help"],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        assert help_result.returncode == 0 and "operations" in help_result.stdout
        assert run("doctor")["network"] == "reachable"
        assert run("notebooks", "list")["items"][0]["id"] == notebook["id"]
        markdown = tmp_path / "draft.md"
        markdown.write_text("# Agent heading\n\nDraft text with **format**.")
        operation = str(uuid4())
        created = run(
            "notes",
            "import",
            "--notebook",
            notebook["id"],
            "--title",
            "Agent document",
            "--file",
            str(markdown),
            "--operation-id",
            operation,
        )
        note = created["note_id"]
        assert (
            run(
                "notes",
                "import",
                "--notebook",
                notebook["id"],
                "--title",
                "Agent document",
                "--file",
                str(markdown),
                "--operation-id",
                operation,
            )["note_id"]
            == note
        )
        assert (
            run("notes", "resolve", "--url", base + "/documents/" + note)["items"][0][
                "id"
            ]
            == note
        )
        assert run("notes", "search", "format")["items"][0]["id"] == note
        page = run("blocks", "list", "--note", note, "--version", "1")
        paragraph = next(
            block for block in page["blocks"]["blocks"] if block["type"] == "paragraph"
        )
        operation_file = tmp_path / "operations.json"
        payload = {
            "operation_id": str(uuid4()),
            "expected_version": 1,
            "operations": [
                {
                    "type": "replace_text",
                    "block_id": paragraph["id"],
                    "match": "Draft",
                    "replacement": "Reviewed",
                }
            ],
        }
        operation_file.write_text(json.dumps(payload))
        assert (
            run("operations", "preview", "--note", note, "--file", str(operation_file))[
                "durability"
            ]
            == "preview"
        )
        applied = run(
            "operations", "apply", "--note", note, "--file", str(operation_file)
        )
        assert applied["content_version"] == 2
        assert run("operations", "get", payload["operation_id"])["content_version"] == 2
        assert "Reviewed" in json.dumps(
            run("blocks", "get", paragraph["id"], "--note", note, "--min-version", "2")
        )
        exported = tmp_path / "export.md"
        assert run(
            "notes",
            "export",
            note,
            "--version",
            "2",
            "--format",
            "markdown",
            "--out",
            str(exported),
        )["complete"]
        assert (
            "Reviewed" in exported.read_text() and "**format**" in exported.read_text()
        )
        attachment = tmp_path / "attachment.txt"
        attachment.write_text("Remote attached content")
        uploaded = run(
            "files",
            "upload",
            "--note",
            note,
            "--file",
            str(attachment),
            "--operation-id",
            str(uuid4()),
        )
        downloaded = tmp_path / "download.txt"
        assert run(
            "files",
            "download",
            uploaded["id"],
            "--note",
            note,
            "--out",
            str(downloaded),
        )["verified"]
        assert downloaded.read_bytes() == attachment.read_bytes()
        attach = {
            "operation_id": str(uuid4()),
            "expected_version": 2,
            "operations": [
                {
                    "type": "insert_blocks",
                    "after_id": paragraph["id"],
                    "blocks": [uploaded["block_template"]],
                }
            ],
        }
        operation_file.write_text(json.dumps(attach))
        assert (
            run("operations", "apply", "--note", note, "--file", str(operation_file))[
                "content_version"
            ]
            == 3
        )
        share = run(
            "shares",
            "create",
            "--notebook",
            notebook["id"],
            "--root-note",
            note,
            "--acknowledge-public-scope",
        )
        assert share["behavior"] == "live"
        public = api(share["path"].replace("/share/", "/public/shares/"))
        assert public["items"][0]["id"] == note
        assert (
            run("shares", "list", "--notebook", notebook["id"])["items"][0]["path"]
            == share["path"]
        )
        assert run("shares", "revoke", share["id"])["revoked_at_ms"] is not None
        large = tmp_path / "large-import.md"
        paragraphs = "\n\n".join(
            "Paragraph " + str(index) + ": " + "readable text " * 110
            for index in range(2200)
        )
        crossing_fence = "```text\n" + "literal **code** line\n" * 14000 + "```"
        large.write_text(
            "# Large streamed library\n\n"
            + paragraphs
            + "\n\n"
            + crossing_fence
            + "\n\n**import-tail-marker** remains bold.\n"
        )
        assert large.stat().st_size >= 3 * 1024 * 1024
        import_operation = str(uuid4())
        imported = run(
            "notes",
            "import",
            "--notebook",
            notebook["id"],
            "--title",
            "Large remote import",
            "--file",
            str(large),
            "--operation-id",
            import_operation,
            "--wait-seconds",
            "60",
        )
        assert (
            imported["durability"] == "committed"
            and imported["source_sha256"]
            == hashlib.sha256(large.read_bytes()).hexdigest()
        )
        replay = run(
            "notes",
            "import",
            "--notebook",
            notebook["id"],
            "--title",
            "Large remote import",
            "--file",
            str(large),
            "--operation-id",
            import_operation,
        )
        assert replay["note_id"] == imported["note_id"]
        found = run("notes", "search", "import-tail-marker")["items"]
        matched = next(item for item in found if item["id"] == imported["note_id"])
        target = run(
            "blocks",
            "get",
            matched["matches"][0]["block_id"],
            "--note",
            imported["note_id"],
        )
        assert target["block"]["content"][0]["styles"]["bold"] is True
        complete = tmp_path / "large-export.md"
        exported = run(
            "notes",
            "export",
            imported["note_id"],
            "--version",
            "1",
            "--format",
            "markdown",
            "--out",
            str(complete),
        )
        assert (
            exported["complete"]
            and "literal **code** line" in complete.read_text()
            and "**import-tail-marker**" in complete.read_text()
        )
    finally:
        process.terminate()
        process.wait(timeout=10)
