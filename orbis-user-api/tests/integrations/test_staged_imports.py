import hashlib
import time
from uuid import uuid4

from orbis_user_api.models.note import Note
from sqlalchemy import func, select


def begin(client, library, source, title="Staged document", operation_id=None):
    response = client.post(
        "/open/v1/imports/markdown",
        headers=library["headers"],
        json={
            "operation_id": operation_id or str(uuid4()),
            "notebook_id": library["notebook"]["id"],
            "title": title,
            "total_bytes": len(source),
            "source_sha256": hashlib.sha256(source).hexdigest(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def upload(client, library, import_id, source, offset=0):
    response = client.put(
        f"/open/v1/imports/{import_id}/chunks",
        headers=library["headers"],
        params={"offset": offset, "sha256": hashlib.sha256(source).hexdigest()},
        content=source,
    )
    return response


def wait(client, library, import_id):
    for _ in range(100):
        state = client.get(
            f"/open/v1/imports/{import_id}", headers=library["headers"]
        ).json()["data"]
        if state["status"] in {"committed", "failed"}:
            return state
        time.sleep(0.05)
    raise AssertionError("Import did not reach a terminal state")


def test_chunk_retries_resume_offsets_and_finalize_replay_create_one_document(
    client, library
):
    source = b"# Resume\n\n**Bold text** survives a streamed upload.\n"
    state = begin(client, library, source)
    first, second = source[:20], source[20:]
    response = upload(client, library, state["import_id"], first)
    assert (
        response.status_code == 200 and response.json()["data"]["received_bytes"] == 20
    )
    retried = upload(client, library, state["import_id"], first)
    assert retried.status_code == 200 and retried.json()["data"]["duplicate"]
    assert upload(client, library, state["import_id"], b"x" * 20).status_code == 409
    resumed = begin(client, library, source, operation_id=state["operation_id"])
    assert (
        resumed["import_id"] == state["import_id"] and resumed["received_bytes"] == 20
    )
    assert (
        upload(client, library, state["import_id"], second, offset=20).status_code
        == 200
    )
    final = client.post(
        f"/open/v1/imports/{state['import_id']}/finalize", headers=library["headers"]
    )
    assert final.status_code == 202, final.text
    completed = wait(client, library, state["import_id"])
    assert completed["status"] == "committed", completed
    replay = client.post(
        f"/open/v1/imports/{state['import_id']}/finalize", headers=library["headers"]
    ).json()["data"]
    assert replay["result"]["note_id"] == completed["result"]["note_id"]
    exported = client.get(
        f"/open/v1/notes/{completed['result']['note_id']}/export",
        headers=library["headers"],
        params={"version": 1, "format": "markdown"},
    ).json()["data"]
    assert "**Bold text**" in exported["content"]

    async def count():
        async with client.app.state.session_factory() as session:
            return await session.scalar(
                select(func.count())
                .select_from(Note)
                .where(Note.title == "Staged document")
            )

    assert client.portal.call(count) == 1


def test_failed_codec_has_no_active_note_and_permissions_are_rechecked(client, library):
    invalid = b"\xff\xfe\xffnot UTF-8"
    state = begin(client, library, invalid, title="Invalid codec document")
    assert upload(client, library, state["import_id"], invalid).status_code == 200
    assert (
        client.post(
            f"/open/v1/imports/{state['import_id']}/finalize",
            headers=library["headers"],
        ).status_code
        == 202
    )
    completed = wait(client, library, state["import_id"])
    assert (
        completed["status"] == "failed"
        and completed["failure_code"] == "IMPORT_CODEC_INVALID"
    )
    assert (
        client.post(
            "/open/v1/resolve",
            headers=library["headers"],
            json={"title": "Invalid codec document"},
        ).json()["data"]["items"]
        == []
    )


def test_declared_byte_budget_and_each_chunk_budget_are_enforced(client, library):
    response = client.post(
        "/open/v1/imports/markdown",
        headers=library["headers"],
        json={
            "operation_id": str(uuid4()),
            "notebook_id": library["notebook"]["id"],
            "title": "Over budget",
            "total_bytes": 32 * 1024 * 1024 + 1,
            "source_sha256": "a" * 64,
        },
    )
    assert response.status_code == 413
    data = b"a" * (256 * 1024 + 1)
    state = begin(client, library, data)
    assert upload(client, library, state["import_id"], data).status_code == 413
    assert (
        client.get(
            f"/open/v1/imports/{state['import_id']}", headers=library["headers"]
        ).json()["data"]["received_bytes"]
        == 0
    )


def test_revoked_permission_during_codec_cannot_publish_a_note(
    client, library, monkeypatch
):
    from threading import Event
    from uuid import UUID

    from orbis_user_api.application import library_imports
    from orbis_user_api.models.integration import IntegrationImport

    entered, release = Event(), Event()
    original = library_imports.decode_import

    def paused_codec(*args):
        entered.set()
        assert release.wait(10)
        return original(*args)

    monkeypatch.setattr(library_imports, "decode_import", paused_codec)
    source = b"# Pending\n\nMust not publish after token revocation."
    state = begin(client, library, source, title="Revoked import")
    assert upload(client, library, state["import_id"], source).status_code == 200
    assert (
        client.post(
            f"/open/v1/imports/{state['import_id']}/finalize",
            headers=library["headers"],
        ).status_code
        == 202
    )
    assert entered.wait(10)
    try:
        assert (
            client.post(
                f"/integrations/tokens/{library['token']['id']}/revoke",
                headers=library["jwt"],
            ).status_code
            == 200
        )
    finally:
        release.set()

    async def status_and_note_count():
        async with client.app.state.session_factory() as session:
            record = await session.get(IntegrationImport, UUID(state["import_id"]))
            count = await session.scalar(
                select(func.count())
                .select_from(Note)
                .where(Note.title == "Revoked import")
            )
            return record.status, record.failure_code, count

    for _ in range(100):
        outcome = client.portal.call(status_and_note_count)
        if outcome[0] == "failed":
            break
        time.sleep(0.02)
    assert outcome == ("failed", "INTEGRATION_TOKEN_INVALID", 0)
