import json
from io import BytesIO
from urllib.error import HTTPError, URLError
from uuid import uuid4

import pytest
from orbis_cli.client import Client
from orbis_cli.config import Configuration
from orbis_cli.errors import CliError

TOKEN = "orbis_it_test_secret_value"
WORKSPACE = str(uuid4())


class Response(BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class FakeOpener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        value = next(self.responses)
        if isinstance(value, Exception):
            raise value
        return Response(json.dumps(value).encode())


def ok(data):
    return {"code": "OK", "message": "ok", "request_id": "request", "data": data}


def client(opener):
    return Client(
        Configuration(
            "https://orbis.example/api", WORKSPACE, TOKEN, "env", "test", False
        ),
        opener=opener,
    )


def test_request_workspace_and_secret_redaction():
    opener = FakeOpener([ok({"token": TOKEN, "message": f"echo {TOKEN}", "items": []})])
    data = client(opener).request(
        "GET", "/open/v1/notes", query={"limit": 2, "cursor": None}
    )
    assert TOKEN not in json.dumps(data)
    assert opener.requests[0].get_header("X-workspace-id") == WORKSPACE
    assert (
        opener.requests[0].full_url == "https://orbis.example/api/open/v1/notes?limit=2"
    )


def test_raw_cannot_escape_scoped_namespace():
    for path in (
        "https://other.example/open/v1/me",
        "//other.example/open/v1/me",
        "/notes",
        "/open/v1/../notes",
    ):
        with pytest.raises(CliError) as exc:
            client(FakeOpener([])).request("GET", path)
        assert exc.value.payload["code"] == "CLI_PATH_FORBIDDEN"


def test_lost_response_queries_original_operation_without_duplicate_submit():
    body = {"operation_id": str(uuid4()), "expected_version": 7, "operations": []}
    opener = FakeOpener(
        [
            URLError("response lost"),
            ok({"operation_id": body["operation_id"], "content_version": 8}),
        ]
    )
    result = client(opener).apply("note", body)
    assert result["data"]["content_version"] == 8
    assert [request.method for request in opener.requests] == ["POST", "GET"]
    assert opener.requests[1].full_url.endswith(body["operation_id"])


def test_uncommitted_response_loss_retries_same_key_only():
    operation = str(uuid4())
    body = {"operation_id": operation, "expected_version": 7, "operations": []}
    notfound = HTTPError(
        "url",
        404,
        "not found",
        {},
        BytesIO(
            json.dumps(
                {
                    "code": "OPERATION_NOT_FOUND",
                    "message": "none",
                    "request_id": "req",
                    "data": None,
                }
            ).encode()
        ),
    )
    opener = FakeOpener([URLError("lost"), notfound, ok({"operation_id": operation})])
    client(opener).apply("note", body)
    assert opener.requests[0].data == opener.requests[2].data
    assert len(opener.requests) == 3


def test_conflict_and_auth_are_not_retried_and_errors_are_redacted():
    error = HTTPError(
        "url",
        409,
        "conflict",
        {},
        BytesIO(
            json.dumps(
                {
                    "code": "NOTE_VERSION_CONFLICT",
                    "message": TOKEN,
                    "request_id": "req",
                    "data": {"token": TOKEN},
                }
            ).encode()
        ),
    )
    opener = FakeOpener([error])
    with pytest.raises(CliError) as exc:
        client(opener).apply("note", {"operation_id": str(uuid4())})
    assert exc.value.exit_code == 5
    assert TOKEN not in json.dumps(exc.value.payload)
    assert len(opener.requests) == 1


def test_long_retry_after_is_reported_without_retrying_early():
    error = HTTPError(
        "url",
        429,
        "rate limit",
        {"Retry-After": "120"},
        BytesIO(
            json.dumps(
                {
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "later",
                    "request_id": "req",
                    "data": None,
                }
            ).encode()
        ),
    )
    opener = FakeOpener([error])
    with pytest.raises(CliError) as exc:
        client(opener).request("GET", "/open/v1/me")
    assert exc.value.exit_code == 6
    assert exc.value.payload["data"]["retry_after"] == "120"
    assert len(opener.requests) == 1
