from __future__ import annotations

import hashlib
import json
import math
import mimetypes
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import UUID, uuid4

from . import __version__
from .client import Client
from .config import configuration, save_config, store_token, validate
from .errors import CliError, NetworkError
from .staged_import import (
    HASH_BUFFER_BYTES,
    INLINE_IMPORT_BYTES,
    finalize_and_wait,
    staged_import,
)


def envelope(data):
    return {
        "code": "OK",
        "message": "Command completed",
        "request_id": None,
        "data": data,
    }


def file_text(path):
    try:
        value = (
            sys.stdin.read(1024 * 1024 + 1)
            if path == "-"
            else Path(path).read_text(encoding="utf-8")
        )
        if len(value.encode()) > 1024 * 1024:
            raise CliError("CLI_INPUT_BUDGET_EXCEEDED", "Input exceeds one MiB")
        return value
    except (OSError, UnicodeError):
        raise CliError(
            "CLI_FILE_UNREADABLE", "Unable to read UTF-8 input file"
        ) from None


def json_file(path):
    try:
        result = json.loads(file_text(path))
        if not isinstance(result, dict):
            raise TypeError
        return result
    except (ValueError, TypeError):
        raise CliError(
            "CLI_INPUT_INVALID", "Expected a JSON object in the request file"
        ) from None


def execute(args):
    config = configuration(args)
    family, command = args.family, getattr(args, "command", None)
    if hasattr(args, "wait_seconds") and (
        not math.isfinite(args.wait_seconds) or not 0 <= args.wait_seconds <= 300
    ):
        raise CliError(
            "CLI_WAIT_INVALID", "Import wait must be between zero and 300 seconds"
        )
    if not 0 < config.timeout <= 60:
        raise CliError(
            "CLI_TIMEOUT_INVALID", "Timeout must be between zero and 60 seconds"
        )
    if family == "config":
        if command == "set":
            return envelope(save_config(config))
        return envelope(
            {
                "base_url": config.base_url,
                "workspace_id": config.workspace_id,
                "profile": config.profile,
                "allow_http": config.allow_http,
                "token_source": config.token_source,
            }
        )
    if family == "api":
        return envelope(
            {
                "endpoints": [
                    "GET /capabilities",
                    "GET /me",
                    "GET /workspaces",
                    "GET /notebooks",
                    "GET /notes",
                    "GET /search",
                    "POST /resolve",
                    "POST /notes",
                    "GET /notes/{note_id}",
                    "GET /notes/{note_id}/outline",
                    "GET /notes/{note_id}/blocks",
                    "GET /notes/{note_id}/blocks/{block_id}",
                    "GET /notes/{note_id}/changes",
                    "GET /notes/{note_id}/export",
                    "POST /notes/{note_id}/operations/preview",
                    "POST /notes/{note_id}/operations",
                    "GET /operations/{operation_id}",
                    "GET /schema",
                    "POST /notes/{note_id}/files",
                    "GET /notes/{note_id}/files/{file_id}",
                    "GET /notes/{note_id}/files/{file_id}/content",
                    "GET /shares",
                    "POST /shares",
                    "POST /shares/{share_id}/revoke",
                    "POST /imports/markdown",
                    "GET /imports/{import_id}",
                    "PUT /imports/{import_id}/chunks",
                    "POST /imports/{import_id}/finalize",
                ],
                "prefix": "/open/v1",
                "schema_command": "orbis --json schema",
            }
        )
    if family == "auth" and command == "login":
        token = sys.stdin.readline(1025).strip()
        if not token.startswith("orbis_it_") or len(token) > 1024:
            raise CliError(
                "CLI_TOKEN_INVALID",
                "Expected a bounded Orbis integration token from stdin",
                exit_code=3,
            )
        config = replace(config, token=token, token_source="stdin")
        identity = Client(config).request("GET", "/open/v1/me")
        store_token(config, token)
        save_config(config)
        return envelope(
            {
                "identity": identity["data"],
                "token_source": "keyring",
                "profile": config.profile,
            }
        )
    if family == "auth" and command == "logout":
        validate(config, require_auth=False)
        store_token(config, None)
        return envelope(
            {
                "profile": config.profile,
                "saved_token_removed": True,
                "environment_token_active": config.token_source == "env",
            }
        )
    if family == "doctor":
        data = {
            "client_version": __version__,
            "base_url": config.base_url,
            "workspace_id": config.workspace_id,
            "profile": config.profile,
            "token_available": bool(config.token),
            "token_source": config.token_source,
            "network": "unchecked",
            "missing": [],
        }
        try:
            validate(config)
            client = Client(config)
            data["identity"] = client.request("GET", "/open/v1/me")["data"]
            data["capabilities"] = client.request("GET", "/open/v1/capabilities")[
                "data"
            ]
            data["network"] = "reachable"
        except CliError as exc:
            data["missing"].append(exc.payload["code"])
            data["error"] = exc.payload
            raise CliError(
                "CLI_DOCTOR_FAILED",
                "Orbis setup or connection needs attention",
                data=data,
                exit_code=exc.exit_code,
            ) from None
        return envelope(data)
    client = Client(config)
    if family in {"capabilities", "schema"}:
        return client.request("GET", "/open/v1/" + family)
    if family == "auth":
        return client.request("GET", "/open/v1/me")
    page = {
        "limit": getattr(args, "limit", None),
        "cursor": getattr(args, "cursor", None),
    }
    if family in {"workspaces", "notebooks"}:
        return client.request("GET", "/open/v1/" + family, query=page)
    if family == "notes":
        if command == "list":
            return client.request(
                "GET", "/open/v1/notes", query={**page, "notebook_id": args.notebook}
            )
        if command == "search":
            return client.request(
                "GET", "/open/v1/search", query={**page, "q": args.query}
            )
        if command == "resolve":
            note_id = args.id
            if args.url:
                parsed, base = urlsplit(args.url), urlsplit(config.base_url)
                if parsed.scheme != base.scheme or parsed.netloc != base.netloc:
                    raise CliError(
                        "CLI_FOREIGN_INSTANCE",
                        "Document URL must belong to the configured Orbis instance",
                    )
                parts = parsed.path.strip("/").split("/")
                if len(parts) != 2 or parts[0] != "documents":
                    raise CliError(
                        "CLI_DOCUMENT_URL_INVALID", "Expected /documents/{note_id}"
                    )
                note_id = parts[1]
            if note_id:
                try:
                    UUID(note_id)
                except ValueError:
                    raise CliError(
                        "CLI_NOTE_ID_INVALID", "Note ID must be a UUID"
                    ) from None
            return client.request(
                "POST",
                "/open/v1/resolve",
                body={"note_id": note_id} if note_id else {"title": args.title},
            )
        if command in {"create", "import"}:
            try:
                UUID(args.operation_id)
            except ValueError:
                raise CliError(
                    "CLI_OPERATION_ID_INVALID", "Operation ID must be a UUID"
                ) from None
            if args.file == "-":
                from .staged_import import DEFAULT_MAX_IMPORT_BYTES

                with tempfile.TemporaryDirectory(prefix="orbis-import-") as directory:
                    source_path = Path(directory) / "stdin.md"
                    total = 0
                    with source_path.open("wb") as target:
                        while incoming := sys.stdin.buffer.read(HASH_BUFFER_BYTES):
                            total += len(incoming)
                            if total > DEFAULT_MAX_IMPORT_BYTES:
                                raise CliError(
                                    "CLI_IMPORT_BUDGET_EXCEEDED",
                                    "stdin exceeds the default import budget",
                                )
                            target.write(incoming)
                    from argparse import Namespace

                    staged_args = Namespace(**{**vars(args), "file": str(source_path)})
                    return staged_import(client, staged_args)
            if args.file and args.file != "-":
                try:
                    if Path(args.file).stat().st_size > INLINE_IMPORT_BYTES:
                        return staged_import(client, args)
                except OSError:
                    raise CliError(
                        "CLI_FILE_UNREADABLE", "Unable to read Markdown source"
                    ) from None
            body = {
                "operation_id": args.operation_id,
                "notebook_id": args.notebook,
                "title": args.title,
                "parent_id": args.parent,
                "markdown": file_text(args.file) if args.file else "",
            }
            if args.dry_run:
                return envelope(
                    {
                        "preview": "local",
                        "request": body,
                        "server_validation": "not performed",
                    }
                )
            return client.idempotent("/open/v1/notes", body)
        path = "/open/v1/notes/" + quote(args.note_id, safe="")
        if command == "get":
            return client.request("GET", path)
        if command == "outline":
            return client.request(
                "GET", path + "/outline", query={**page, "version": args.version}
            )
        if command == "changes":
            return client.request(
                "GET",
                path + "/changes",
                query={
                    **page,
                    "version": args.version,
                    "since_version": args.since_version,
                },
            )
        if command == "export":
            result = client.request(
                "GET",
                path + "/export",
                query={"version": args.version, "format": args.format},
            )
            data = result["data"]
            content = data.pop("content")
            output = Path(args.out).resolve()
            rendered = (
                json.dumps(content, ensure_ascii=False, indent=2)
                if args.format == "json"
                else content
            )
            try:
                output.write_text(rendered, encoding="utf-8")
            except OSError:
                raise CliError(
                    "CLI_OUTPUT_UNWRITABLE", "Unable to write export file"
                ) from None
            data.update({"path": str(output), "bytes": len(rendered.encode())})
            return result
    if family == "imports":
        state = client.request(
            "GET", "/open/v1/imports/" + quote(args.import_id, safe="")
        )
        if command == "get":
            return state
        return finalize_and_wait(
            client, state["data"], args.wait_seconds, explicit_resume=True
        )
    if family == "blocks":
        path = "/open/v1/notes/" + quote(args.note, safe="") + "/blocks"
        if command == "list":
            return client.request(
                "GET",
                path,
                query={**page, "parent_id": args.parent, "version": args.version},
            )
        return client.request(
            "GET",
            path + "/" + quote(args.block_id, safe=""),
            query={"version": args.version, "min_version": args.min_version},
        )
    if family == "operations":
        if command == "get":
            return client.request(
                "GET", "/open/v1/operations/" + quote(args.operation_id, safe="")
            )
        body = json_file(args.file)
        path = "/open/v1/notes/" + quote(args.note, safe="") + "/operations"
        return (
            client.request("POST", path + "/preview", body=body, retries=0)
            if command == "preview"
            else client.apply(args.note, body)
        )
    if family == "files":
        path = "/open/v1/notes/" + quote(args.note, safe="") + "/files"
        if command == "upload":
            try:
                UUID(args.operation_id)
                source = Path(args.file)
                if source.stat().st_size > 20 * 1024 * 1024:
                    raise CliError(
                        "CLI_UPLOAD_BUDGET_EXCEEDED", "Attachment exceeds 20 MiB"
                    )
                content = source.read_bytes()
            except (OSError, ValueError):
                raise CliError(
                    "CLI_UPLOAD_INPUT_INVALID",
                    "Expected a readable attachment and operation UUID",
                ) from None
            boundary = "orbis-" + uuid4().hex
            mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
            name = source.name.replace('"', "_").replace("\r", "_").replace("\n", "_")
            digest = hashlib.sha256(content).hexdigest()
            prefix = f'--{boundary}\r\nContent-Disposition: form-data; name="operation_id"\r\n\r\n{args.operation_id}\r\n--{boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\n{digest}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
            request_body = prefix + content + f"\r\n--{boundary}--\r\n".encode()
            try:
                return client.request(
                    "POST",
                    path,
                    raw=request_body,
                    content_type="multipart/form-data; boundary=" + boundary,
                    retries=0,
                )
            except NetworkError:
                try:
                    return client.request(
                        "GET", "/open/v1/operations/" + args.operation_id
                    )
                except CliError:
                    raise CliError(
                        "CLI_UPLOAD_RESULT_UNKNOWN",
                        "Query the original operation_id before retrying the same upload",
                        data={"operation_id": args.operation_id},
                        exit_code=6,
                    ) from None
        path += "/" + quote(args.file_id, safe="")
        result = client.request("GET", path)
        if command == "get":
            return result
        content = client.request("GET", path + "/content", binary=True)
        if (
            len(content) != result["data"]["file_size"]
            or hashlib.sha256(content).hexdigest() != result["data"]["sha256"]
        ):
            raise CliError(
                "CLI_DOWNLOAD_DIGEST_MISMATCH",
                "Downloaded file failed SHA-256 verification",
                exit_code=7,
            )
        output = Path(args.out).resolve()
        try:
            output.write_bytes(content)
        except OSError:
            raise CliError(
                "CLI_OUTPUT_UNWRITABLE", "Unable to write attachment output"
            ) from None
        result["data"].update(
            {"path": str(output), "bytes": len(content), "verified": True}
        )
        return result
    if family == "shares":
        if command == "list":
            return client.request(
                "GET", "/open/v1/shares", query={**page, "notebook_id": args.notebook}
            )
        if command == "create":
            return client.request(
                "POST",
                "/open/v1/shares",
                body={
                    "notebook_id": args.notebook,
                    "root_note_id": args.root_note,
                    "acknowledge_public_scope": args.acknowledge_public_scope,
                },
                retries=0,
            )
        return client.request(
            "POST",
            "/open/v1/shares/" + quote(args.share_id, safe="") + "/revoke",
            retries=0,
        )
    if family == "request":
        body = json_file(args.file) if command == "post" else None
        return client.request(
            command.upper(), args.path, body=body, retries=0 if body else 2
        )
    raise CliError("CLI_COMMAND_UNSUPPORTED", "Command is unavailable", exit_code=8)
