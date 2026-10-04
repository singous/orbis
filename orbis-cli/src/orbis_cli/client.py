from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID

from . import __version__
from .config import Configuration, validate
from .errors import EXIT_CODES, CliError, NetworkError

MAX_RESPONSE_BYTES = 12 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, config: Configuration, opener=None):
        validate(config)
        self.config = config
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    def redact(self, value):
        if isinstance(value, str):
            return (
                value.replace(self.config.token, "[REDACTED]")
                if self.config.token
                else value
            )
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, dict):
            return {
                key: "[REDACTED]"
                if key.lower()
                in {
                    "token",
                    "access_token",
                    "refresh_token",
                    "authorization",
                    "password",
                    "secret",
                }
                else self.redact(item)
                for key, item in value.items()
            }
        return value

    def request(
        self,
        method: str,
        path: str,
        *,
        query=None,
        body=None,
        retries=2,
        raw=None,
        content_type=None,
        binary=False,
    ):
        parsed = urlsplit(path)
        if (
            parsed.scheme
            or parsed.netloc
            or not parsed.path.startswith("/open/v1/")
            or ".." in parsed.path.split("/")
            or parsed.fragment
        ):
            raise CliError(
                "CLI_PATH_FORBIDDEN",
                "Raw requests must stay within /open/v1 on the configured instance",
            )
        url = self.config.base_url + path
        if query:
            url += ("&" if "?" in path else "?") + urlencode(
                {key: value for key, value in query.items() if value is not None}
            )
        encoded = (
            raw
            if raw is not None
            else json.dumps(body, ensure_ascii=False).encode()
            if body is not None
            else None
        )
        headers = {
            "Accept": "application/json",
            "Authorization": "Bearer " + self.config.token,
            "X-Workspace-ID": self.config.workspace_id,
            "User-Agent": f"orbis-cli/{__version__}",
        }
        if encoded is not None:
            headers["Content-Type"] = content_type or "application/json"
        for attempt in range(retries + 1):
            try:
                with self.opener.open(
                    Request(url, data=encoded, headers=headers, method=method),
                    timeout=self.config.timeout,
                ) as response:
                    budget = 20 * 1024 * 1024 if binary else MAX_RESPONSE_BYTES
                    raw_response = response.read(budget + 1)
                    if len(raw_response) > budget:
                        raise CliError(
                            "CLI_RESPONSE_BUDGET_EXCEEDED",
                            "Response exceeds the client read budget; use bounded content pages",
                        )
                    if binary:
                        return raw_response
                    payload = json.loads(raw_response)
                    if (
                        not isinstance(payload, dict)
                        or not {"code", "message", "request_id", "data"}
                        <= payload.keys()
                    ):
                        raise ValueError
                    return self.redact(payload)
            except HTTPError as exc:
                try:
                    payload = self.redact(json.loads(exc.read(MAX_RESPONSE_BYTES)))
                    if (
                        not isinstance(payload, dict)
                        or not {"code", "message", "data"} <= payload.keys()
                    ):
                        raise ValueError
                except (ValueError, OSError):
                    payload = {
                        "code": "CLI_HTTP_ERROR",
                        "message": f"Orbis returned HTTP {exc.code}",
                        "request_id": None,
                        "data": None,
                    }
                if exc.code == 429 and method == "GET" and attempt < retries:
                    retry_after = exc.headers.get("Retry-After", "1")
                    try:
                        delay = max(0.1, float(retry_after))
                    except ValueError:
                        try:
                            deadline = parsedate_to_datetime(retry_after)
                            delay = max(
                                0.1,
                                (deadline - datetime.now(timezone.utc)).total_seconds(),
                            )
                        except (ValueError, TypeError, OverflowError):
                            delay = 1
                    if delay <= 3:
                        time.sleep(delay)
                        continue
                    # Do not violate a long server backoff or keep an agent
                    # blocked in a silent wait. Preserve the retry hint.
                    payload["data"] = {
                        "retry_after": retry_after,
                        "server_data": payload["data"],
                    }
                raise CliError(
                    payload["code"],
                    payload["message"],
                    data=payload["data"],
                    request_id=payload.get("request_id"),
                    exit_code=EXIT_CODES.get(exc.code, 7),
                ) from None
            except (URLError, TimeoutError, ConnectionError, OSError):
                if method == "GET" and attempt < retries:
                    time.sleep(0.2 * 2**attempt)
                    continue
                raise NetworkError() from None
            except (ValueError, UnicodeError):
                raise CliError(
                    "CLI_RESPONSE_INVALID",
                    "Orbis returned an invalid API envelope",
                    exit_code=7,
                ) from None
        raise NetworkError()

    def apply(self, note_id: str, body: dict) -> dict:
        return self.idempotent("/open/v1/notes/" + note_id + "/operations", body)

    def idempotent(self, path: str, body: dict) -> dict:
        operation_id = body.get("operation_id")
        try:
            UUID(operation_id or "")
        except (ValueError, TypeError, AttributeError):
            raise CliError(
                "CLI_OPERATION_ID_REQUIRED",
                "Write requests require a stable operation UUID",
            ) from None
        for attempt in range(2):
            try:
                return self.request("POST", path, body=body, retries=0)
            except NetworkError:
                try:
                    return self.request("GET", "/open/v1/operations/" + operation_id)
                except CliError as exc:
                    if exc.payload["code"] != "OPERATION_NOT_FOUND":
                        raise NetworkError(
                            "Write result is still unknown; query the original operation_id",
                            data={"operation_id": operation_id},
                        ) from None
                if attempt == 1:
                    raise NetworkError(
                        "Write result is still unknown; query the original operation_id",
                        data={"operation_id": operation_id},
                    ) from None
        raise NetworkError(data={"operation_id": operation_id})
