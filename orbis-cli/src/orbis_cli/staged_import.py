"""Streaming/resumable Markdown transport; observation never restarts a live job."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

from .errors import CliError, NetworkError

DEFAULT_MAX_IMPORT_BYTES = 32 * 1024 * 1024
INLINE_IMPORT_BYTES = 512 * 1024
HASH_BUFFER_BYTES = 64 * 1024


def source_fingerprint(path: Path, maximum: int):
    try:
        stat = path.stat()
        if not 0 < stat.st_size <= maximum:
            raise CliError(
                "CLI_IMPORT_BUDGET_EXCEEDED",
                "Markdown size exceeds the import budget",
                data={"bytes": stat.st_size, "max_bytes": maximum},
            )
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(HASH_BUFFER_BYTES):
                digest.update(chunk)
        current = path.stat()
        if (current.st_size, current.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
            raise CliError(
                "CLI_SOURCE_CHANGED",
                "Markdown changed while its fingerprint was calculated",
            )
        return stat, digest.hexdigest()
    except OSError:
        raise CliError(
            "CLI_FILE_UNREADABLE", "Unable to read Markdown source"
        ) from None


def pending(state):
    return CliError(
        "CLI_IMPORT_PENDING",
        "Import result is still pending; query the original import instead of restarting it",
        data=state,
        exit_code=6,
    )


def wait_import(client, import_id: str, wait_seconds: float):
    deadline = time.monotonic() + wait_seconds
    while True:
        result = client.request("GET", "/open/v1/imports/" + import_id)
        state = result["data"]
        if state["status"] == "committed":
            result["data"] = {
                **state["result"],
                "import_id": import_id,
                "source_sha256": state["source_sha256"],
            }
            return result
        if state["status"] == "failed":
            raise CliError(
                state["failure_code"] or "CLI_IMPORT_FAILED",
                "Import failed before creating a document",
                data=state,
                exit_code=2,
            )
        if time.monotonic() >= deadline:
            raise pending(state)
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))


def finalize_and_wait(
    client, state: dict, wait_seconds: float, *, explicit_resume=False
):
    import_id = state["import_id"]
    if state["status"] == "committed":
        return wait_import(client, import_id, 0)
    # A new invocation may resume a missing backend task. An observation timeout
    # within this invocation only reads status, even if the request was lost.
    if state["status"] == "uploading" or (
        explicit_resume and not state.get("job_active")
    ):
        try:
            client.request(
                "POST", "/open/v1/imports/" + import_id + "/finalize", retries=0
            )
        except NetworkError:
            try:
                state = client.request("GET", "/open/v1/imports/" + import_id)["data"]
            except CliError:
                raise pending(
                    {
                        "import_id": import_id,
                        "operation_id": state["operation_id"],
                        "status": "unknown",
                    }
                ) from None
            if state["status"] == "uploading":
                raise pending(state) from None
    return wait_import(client, import_id, wait_seconds)


def staged_import(client, args):
    path = Path(args.file)
    maximum = DEFAULT_MAX_IMPORT_BYTES
    if not args.dry_run:
        capabilities = client.request("GET", "/open/v1/capabilities")["data"]
        if not capabilities["features"].get("large_markdown_import"):
            raise CliError(
                "CLI_CAPABILITY_UNSUPPORTED",
                "This Orbis instance does not support resumable Markdown imports",
                exit_code=8,
            )
        maximum = capabilities["imports"]["max_bytes"]
    stat, digest = source_fingerprint(path, maximum)
    body = {
        "operation_id": args.operation_id,
        "notebook_id": args.notebook,
        "parent_id": args.parent,
        "title": args.title,
        "total_bytes": stat.st_size,
        "source_sha256": digest,
    }
    if args.dry_run:
        return {
            "code": "OK",
            "message": "Local import plan prepared",
            "request_id": None,
            "data": {
                "flow": "staged",
                "request": body,
                "server_validation": "not performed",
            },
        }
    try:
        response = client.request(
            "POST", "/open/v1/imports/markdown", body=body, retries=0
        )
    except NetworkError:
        # Session creation is idempotent; it cannot schedule or restart a codec.
        response = client.request(
            "POST", "/open/v1/imports/markdown", body=body, retries=0
        )
    state = response["data"]
    if state["status"] != "uploading":
        return finalize_and_wait(client, state, args.wait_seconds, explicit_resume=True)
    chunk_bytes, import_id = state["chunk_bytes"], state["import_id"]
    try:
        with path.open("rb") as source:
            while state["received_bytes"] < state["total_bytes"]:
                offset = state["received_bytes"]
                source.seek(offset)
                content = source.read(chunk_bytes)
                if not content:
                    raise CliError(
                        "CLI_SOURCE_CHANGED", "Markdown became shorter during upload"
                    )
                query = {
                    "offset": offset,
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
                try:
                    state = client.request(
                        "PUT",
                        "/open/v1/imports/" + import_id + "/chunks",
                        query=query,
                        raw=content,
                        content_type="application/octet-stream",
                        retries=0,
                    )["data"]
                except NetworkError:
                    state = client.request("GET", "/open/v1/imports/" + import_id)[
                        "data"
                    ]
                    if state["received_bytes"] == offset:
                        state = client.request(
                            "PUT",
                            "/open/v1/imports/" + import_id + "/chunks",
                            query=query,
                            raw=content,
                            content_type="application/octet-stream",
                            retries=0,
                        )["data"]
                if state["received_bytes"] <= offset:
                    raise pending(state)
        current = path.stat()
        if (current.st_size, current.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
            raise CliError(
                "CLI_SOURCE_CHANGED",
                "Markdown changed during upload; do not reuse its import operation ID",
            )
    except OSError:
        raise CliError(
            "CLI_FILE_UNREADABLE", "Unable to continue reading the Markdown source"
        ) from None
    return finalize_and_wait(client, state, args.wait_seconds)
