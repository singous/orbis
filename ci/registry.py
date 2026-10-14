"""Authenticate registry clients and keep same-host image layers on loopback."""

from __future__ import annotations

import contextlib
import os
import re
import subprocess
import tempfile
from collections.abc import Iterator

REGISTRY_ADDRESS = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9.-]*(?::[0-9]+)?\Z")


def validate_address(address: str) -> str:
    if not REGISTRY_ADDRESS.fullmatch(address):
        raise ValueError("Registry must be a hostname with an optional port")
    if ":" in address and not 1 <= int(address.rsplit(":", 1)[1]) <= 65535:
        raise ValueError("Invalid registry port")
    return address


def transport_image(image: str, registry: str, transport: str | None) -> str:
    validate_address(registry)
    if not transport:
        return image
    validate_address(transport)
    prefix = registry + "/"
    return transport + "/" + image[len(prefix) :] if image.startswith(prefix) else image


@contextlib.contextmanager
def authenticated(
    registry: str, transport: str | None = None, docker_config: str | None = None
) -> Iterator[dict[str, str]]:
    addresses = list(dict.fromkeys(validate_address(v) for v in [registry, transport] if v))
    username = os.environ.get("ORBIS_REGISTRY_USERNAME")
    password = os.environ.get("ORBIS_REGISTRY_PASSWORD")
    if bool(username) != bool(password):
        raise ValueError("Both registry username and password are required")
    environment = dict(os.environ)
    if not username:
        if docker_config:
            environment["DOCKER_CONFIG"] = docker_config
        yield environment
        return
    with tempfile.TemporaryDirectory(prefix="orbis-registry-") as directory:
        environment["DOCKER_CONFIG"] = directory
        # Credentials only reach docker through stdin and a temporary config.
        environment.pop("ORBIS_REGISTRY_PASSWORD", None)
        for address in addresses:
            subprocess.run(
                ["docker", "login", address, "--username", username, "--password-stdin"],
                input=password + "\n",
                text=True,
                env=environment,
                check=True,
                timeout=60,
            )
        yield environment


def prefetch(
    images: list[str], registry: str, transport: str | None, environment: dict[str, str]
) -> None:
    for image in images:
        local = transport_image(image, registry, transport)
        if local != image:
            subprocess.run(["docker", "pull", local], env=environment, check=True, timeout=600)
