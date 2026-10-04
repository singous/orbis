from types import SimpleNamespace

import pytest
from orbis_cli.errors import CliError, NetworkError
from orbis_cli.staged_import import finalize_and_wait, staged_import


def ok(data):
    return {"code": "OK", "message": "ok", "request_id": "req", "data": data}


def test_lost_finalize_observation_never_restarts_an_active_job():
    state = {
        "import_id": "import",
        "operation_id": "operation",
        "status": "uploading",
        "job_active": False,
    }
    active = {**state, "status": "finalizing", "job_active": True}
    calls = []

    class Client:
        def request(self, method, path, **kwargs):
            calls.append((method, path))
            if method == "POST":
                raise NetworkError("Response lost after scheduling")
            return ok(active)

    with pytest.raises(CliError) as failure:
        finalize_and_wait(Client(), state, 0)
    assert failure.value.payload["code"] == "CLI_IMPORT_PENDING"
    assert [method for method, _path in calls].count("POST") == 1
    assert failure.value.payload["data"]["job_active"] is True


def test_resume_seeks_confirmed_offset_and_uses_the_original_operation_id(tmp_path):
    path = tmp_path / "large.md"
    content = b"# Header\n\n" + b"Plain readable body\n\n" * 30000
    path.write_bytes(content)
    confirmed = 256 * 1024
    state = {
        "import_id": "import",
        "operation_id": "fixed-operation",
        "status": "uploading",
        "job_active": False,
        "chunk_bytes": 256 * 1024,
        "received_bytes": confirmed,
        "total_bytes": len(content),
        "source_sha256": "source",
    }
    uploaded = []

    class Client:
        def request(self, method, target, **kwargs):
            if target.endswith("capabilities"):
                return ok(
                    {
                        "features": {"large_markdown_import": True},
                        "imports": {"max_bytes": 32 * 1024 * 1024},
                    }
                )
            if target.endswith("imports/markdown"):
                assert kwargs["body"]["operation_id"] == "fixed-operation"
                return ok(dict(state))
            if target.endswith("chunks"):
                offset = kwargs["query"]["offset"]
                uploaded.append((offset, kwargs["raw"]))
                assert kwargs["raw"] == content[offset : offset + len(kwargs["raw"])]
                state["received_bytes"] += len(kwargs["raw"])
                return ok(dict(state))
            if target.endswith("finalize"):
                state.update(
                    status="committed",
                    result={"note_id": "one-note", "durability": "committed"},
                )
                return ok(dict(state))
            return ok(dict(state))

    args = SimpleNamespace(
        file=str(path),
        dry_run=False,
        operation_id="fixed-operation",
        notebook="notebook",
        parent=None,
        title="Title",
        wait_seconds=0,
    )
    result = staged_import(Client(), args)
    assert result["data"]["note_id"] == "one-note"
    assert uploaded[0][0] == confirmed
    assert b"".join(chunk for _offset, chunk in uploaded) == content[confirmed:]
