from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import keyring
from keyring.errors import KeyringError

from .errors import CliError


@dataclass(frozen=True)
class Configuration:
    base_url: str | None
    workspace_id: str | None
    token: str | None
    token_source: str
    profile: str
    allow_http: bool
    timeout: float = 15


def config_path() -> Path:
    directory = Path(
        os.environ.get("ORBIS_CONFIG_DIR", Path.home() / ".config" / "orbis")
    )
    return directory / "config.json"


def profiles() -> dict:
    path = config_path()
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
        if not isinstance(value, dict) or any(
            not isinstance(profile, dict) for profile in value.values()
        ):
            raise ValueError
        return value
    except (OSError, ValueError):
        raise CliError(
            "CLI_CONFIG_INVALID",
            "Orbis config is not a valid JSON object",
            data={"path": str(path)},
        ) from None


def credential_name(profile: str, base_url: str) -> str:
    return profile + ":" + hashlib.sha256(base_url.encode()).hexdigest()


def saved_token(profile: str, base_url: str | None) -> str | None:
    if not base_url:
        return None
    try:
        return keyring.get_password("orbis-cli", credential_name(profile, base_url))
    except (KeyringError, OSError, RuntimeError):
        return None


def configuration(args) -> Configuration:
    profile = getattr(args, "profile", None) or os.environ.get(
        "ORBIS_PROFILE", "default"
    )
    saved = profiles().get(profile, {})
    if any(
        key in saved and not isinstance(saved[key], str)
        for key in ("base_url", "workspace_id")
    ) or ("allow_http" in saved and not isinstance(saved["allow_http"], bool)):
        raise CliError(
            "CLI_CONFIG_INVALID",
            "Profile URL/workspace must be strings and allow_http must be boolean",
        )
    base = (
        getattr(args, "base_url", None)
        or os.environ.get("ORBIS_BASE_URL")
        or saved.get("base_url")
    )
    workspace = (
        getattr(args, "workspace", None)
        or os.environ.get("ORBIS_WORKSPACE_ID")
        or saved.get("workspace_id")
    )
    token = os.environ.get("ORBIS_TOKEN") or saved_token(profile, base)
    source = (
        "env" if os.environ.get("ORBIS_TOKEN") else "keyring" if token else "missing"
    )
    return Configuration(
        base.rstrip("/") if base else None,
        workspace,
        token,
        source,
        profile,
        getattr(args, "allow_http", False) or saved.get("allow_http", False),
        getattr(args, "timeout", 15),
    )


def validate(config: Configuration, *, require_auth=True) -> None:
    if not config.base_url:
        raise CliError(
            "CLI_CONFIG_MISSING", "Set ORBIS_BASE_URL or run config set --base-url URL"
        )
    try:
        parsed = urlsplit(config.base_url)
        _ = parsed.port
    except ValueError:
        raise CliError("CLI_URL_INVALID", "Base URL is malformed") from None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise CliError(
            "CLI_URL_INVALID",
            "Base URL must be an HTTP(S) URL without credentials, query or fragment",
        )
    if parsed.scheme == "http" and not config.allow_http:
        raise CliError(
            "CLI_HTTPS_REQUIRED",
            "HTTP requires explicit --allow-http for a trusted development instance",
        )
    try:
        UUID(config.workspace_id or "")
    except ValueError:
        raise CliError(
            "CLI_WORKSPACE_REQUIRED", "Provide --workspace UUID or ORBIS_WORKSPACE_ID"
        ) from None
    if require_auth and not config.token:
        raise CliError(
            "CLI_AUTH_MISSING",
            "Configure ORBIS_TOKEN or run auth login --token-stdin",
            exit_code=3,
        )


def save_config(config: Configuration) -> dict:
    validate(config, require_auth=False)
    data = profiles()
    data[config.profile] = {
        "base_url": config.base_url,
        "workspace_id": config.workspace_id,
        "allow_http": config.allow_http,
    }
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(data, stream, indent=2)
    temporary.replace(path)
    return {"profile": config.profile, "path": str(path), **data[config.profile]}


def store_token(config: Configuration, token: str | None) -> None:
    try:
        name = credential_name(config.profile, config.base_url or "")
        if token is None:
            if keyring.get_password("orbis-cli", name):
                keyring.delete_password("orbis-cli", name)
        else:
            keyring.set_password("orbis-cli", name, token)
    except (KeyringError, OSError, RuntimeError):
        raise CliError(
            "CLI_CREDENTIAL_STORE_UNAVAILABLE",
            "OS credential store is unavailable; supply ORBIS_TOKEN through your secret manager",
            exit_code=3,
        ) from None
