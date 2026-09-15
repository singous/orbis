from __future__ import annotations

import ipaddress
import posixpath
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, parse_qsl, unquote, urlsplit

import idna

from orbis_user_api.application.site_errors import unsafe_site_content

# These names carry authentication or private signed-download capabilities.
# Generic public resource options such as download/version/filename remain valid.
CREDENTIAL_QUERY_KEYS = frozenset(
    {
        "token",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "authtoken",
        "downloadtoken",
        "securitytoken",
        "apikey",
        "accesskey",
        "secret",
        "clientsecret",
        "clientassertion",
        "password",
        "passwd",
        "authorization",
        "auth",
        "authkey",
        "session",
        "sessionid",
        "credential",
        "credentials",
        "signature",
        "sig",
        "keypairid",
        "policy",
        "xamzcredential",
        "xamzsignature",
        "xamzsecuritytoken",
        "xamzalgorithm",
        "xgoogcredential",
        "xgoogsignature",
        "xgoogalgorithm",
        "googleaccessid",
        "awsaccesskeyid",
        "ossaccesskeyid",
        "ossaccesskeysecret",
        "qsignature",
        "qsignalgorithm",
    }
)
INTERNAL_ROUTE_ROOTS = frozenset(
    {
        "notes",
        "notebooks",
        "document-groups",
        "files",
        "users",
        "workspace",
        "sites",
        "auth",
        "login",
        "setup",
        "home",
        "documents",
        "collections",
        "knowledge",
        "memory",
        "settings",
        "invite",
        "invitations",
        "ownership-transfer",
        "ownership-transfers",
        "storage",
        "api",
    }
)
PRIVATE_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")
MAX_PATH_DECODE_ROUNDS = 3
Origin = tuple[str, str, int]


def _canonical_hostname(hostname: str) -> str:
    """Use one browser-compatible identity for both application and IP checks.

    IDNA uses non-transitional UTS46 mapping, including Unicode dots and NFC.
    Noncanonical numeric IPv4 forms are deliberately rejected, since treating
    them as DNS names would disagree with browsers' special IPv4 parser.
    """
    if ":" in hostname:
        # WHATWG HTTP URLs do not support IPv6 zone identifiers.
        if "%" in hostname:
            raise ValueError("Scoped IPv6 hosts are not public URL hosts")
        return str(ipaddress.IPv6Address(hostname))
    decoded = unquote(hostname, encoding="utf-8", errors="strict")
    ascii_host = (
        idna.encode(decoded, uts46=True, transitional=False, std3_rules=True)
        .decode("ascii")
        .removesuffix(".")
    )
    try:
        return str(ipaddress.IPv4Address(ascii_host))
    except ipaddress.AddressValueError:
        last_label = ascii_host.rsplit(".", 1)[-1]
        if re.fullmatch(r"[0-9]+|0x[0-9a-f]*", last_label):
            raise ValueError(
                "Noncanonical numeric IPv4 hosts are not supported"
            ) from None
    return ascii_host


def _origin(parsed: SplitResult) -> Origin:
    return (
        parsed.scheme.lower(),
        _canonical_hostname(parsed.hostname or ""),
        parsed.port or (443 if parsed.scheme.lower() == "https" else 80),
    )


def _normalized_path(path: str) -> str:
    for _ in range(MAX_PATH_DECODE_ROUNDS):
        decoded = unquote(path)
        if decoded == path:
            break
        path = decoded
    return "/" + posixpath.normpath("/" + path.lstrip("/")).lstrip("/")


def _has_credentials(parsed: SplitResult) -> bool:
    fragments = (parsed.query, parsed.fragment.split("?", 1)[-1])
    for fragment in fragments:
        for key, _ in parse_qsl(fragment, keep_blank_values=True):
            canonical_key = re.sub(r"[^a-z0-9]", "", key.casefold())
            if canonical_key in CREDENTIAL_QUERY_KEYS:
                return True
    return False


def _private_hostname(hostname: str) -> bool:
    hostname = hostname.casefold().rstrip(".")
    try:
        return not ipaddress.ip_address(hostname).is_global
    except ValueError:
        return (
            "." not in hostname
            or hostname.endswith(PRIVATE_HOST_SUFFIXES)
            or re.fullmatch(r"[0-9.]+", hostname) is not None
        )


@dataclass(frozen=True)
class PublicUrlPolicy:
    """Known application locations plus origin-independent credential restrictions."""

    internal_locations: frozenset[tuple[Origin, str]] = frozenset()
    has_unsupported_location: bool = False

    @classmethod
    def for_app(cls, request_base_url: str, canonical_app_url: str) -> PublicUrlPolicy:
        locations = set()
        unsupported_location = False
        for base in (request_base_url, canonical_app_url):
            try:
                parsed = urlsplit(base)
                if parsed.scheme in {"http", "https"} and parsed.hostname:
                    locations.add((_origin(parsed), _normalized_path(parsed.path)))
                else:
                    unsupported_location = True
            except ValueError:
                # Never silently lose the application boundary when a configured
                # URL uses a malformed or unsupported hostname representation.
                unsupported_location = True
        return cls(frozenset(locations), unsupported_location)

    def _internal_resource(self, parsed: SplitResult, origin: Origin) -> bool:
        # Changing scheme or port must not expose a known application host
        # through a redirect or another listener serving the same private routes.
        prefixes = [
            prefix
            for location, prefix in self.internal_locations
            if location[1] == origin[1]
        ]
        if not prefixes:
            return False
        path = _normalized_path(parsed.path)
        paths = {path}
        for prefix in prefixes:
            if prefix != "/" and path.startswith(prefix.rstrip("/") + "/"):
                paths.add(path[len(prefix.rstrip("/")) :])
        for candidate in tuple(paths):
            if candidate.startswith("/api/"):
                paths.add(candidate[4:])
        if any(
            candidate in {"/s", "/public/sites"}
            or candidate.startswith(("/s/", "/public/sites/"))
            for candidate in paths
        ):
            return False
        return any(
            candidate.lstrip("/").split("/", 1)[0] in INTERNAL_ROUTE_ROOTS
            for candidate in paths
        )

    def validate(self, value: Any, *, media: bool = False) -> str:
        if not isinstance(value, str) or not value or value != value.strip():
            raise unsafe_site_content()
        if any(ord(char) < 33 or ord(char) == 127 for char in value) or "\\" in value:
            raise unsafe_site_content()
        try:
            parsed = urlsplit(value)
            if _has_credentials(parsed):
                raise unsafe_site_content()
            if not media and value.startswith("#"):
                return value
            if (
                not media
                and parsed.scheme == "mailto"
                and parsed.path
                and not parsed.netloc
            ):
                return value
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise unsafe_site_content()
            if parsed.username is not None or parsed.password is not None:
                raise unsafe_site_content()
            if self.has_unsupported_location:
                raise unsafe_site_content()
            origin = _origin(parsed)
            if self._internal_resource(parsed, origin) or _private_hostname(origin[1]):
                raise unsafe_site_content()
        except ValueError:
            raise unsafe_site_content() from None
        return value
