"""PostgreSQL proof that agent receipts and sparse content share a transaction."""

from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select
from test_postgres_base_mvp import postgres_client as postgres_fixture
from test_postgres_base_mvp import request_data, setup_document

from orbis_user_api.models.integration import IntegrationOperation
from orbis_user_api.models.note_block import NoteBlockVersion

postgres_client = postgres_fixture


def setup_agent(client):
    headers, note = setup_document(client)
    workspace = request_data(client, "GET", "/workspaces", headers=headers)["items"][0][
        "id"
    ]
    headers["X-Workspace-ID"] = workspace
    request_data(
        client,
        "PUT",
        f"/notes/{note['id']}/content",
        headers=headers,
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [
                    {
                        "id": "paragraph",
                        "type": "paragraph",
                        "props": {},
                        "content": [{"type": "text", "text": "Before"}],
                        "children": [],
                    }
                ],
            },
        },
    )
    token = request_data(
        client,
        "POST",
        "/integrations/tokens",
        status=201,
        headers=headers,
        json={
            "name": "PostgreSQL agent",
            "permissions": ["notes:read", "notes:write"],
            "note_id": note["id"],
        },
    )
    return (
        {"Authorization": "Bearer " + token["token"], "X-Workspace-ID": workspace},
        note,
        token,
    )


def operation():
    return {
        "operation_id": str(uuid4()),
        "expected_version": 2,
        "operations": [
            {
                "type": "replace_text",
                "block_id": "paragraph",
                "match": "Before",
                "replacement": "After",
            }
        ],
    }


def test_postgres_concurrent_same_operation_executes_once(postgres_client):
    client = postgres_client
    headers, note, token = setup_agent(client)
    payload = operation()

    def submit():
        return client.post(
            f"/open/v1/notes/{note['id']}/operations", headers=headers, json=payload
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: submit(), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()["data"] == responses[1].json()["data"]
    assert responses[0].json()["data"]["content_version"] == 3

    async def persisted():
        async with client.app.state.session_factory() as session:
            receipts = list(
                await session.scalars(
                    select(IntegrationOperation).where(
                        IntegrationOperation.token_id == UUID(token["id"])
                    )
                )
            )
            versions = list(
                await session.scalars(
                    select(NoteBlockVersion).where(
                        NoteBlockVersion.note_id == UUID(note["id"]),
                        NoteBlockVersion.block_id == "paragraph",
                    )
                )
            )
            return len(receipts), len(versions)

    assert client.portal.call(persisted) == (1, 2)


def test_postgres_receipt_insert_failure_rolls_back_content_and_history(
    postgres_client,
):
    client = postgres_client
    headers, note, _token = setup_agent(client)
    payload = operation()
    engine = client.app.state.engine.sync_engine

    def fail_receipt(_conn, _cursor, statement, _params, _context, _many):
        if statement.startswith("INSERT INTO integration_operations"):
            raise RuntimeError("Injected receipt persistence failure")

    event.listen(engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(RuntimeError, match="Injected receipt"):
            client.post(
                f"/open/v1/notes/{note['id']}/operations", headers=headers, json=payload
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_receipt)
    current = request_data(
        client, "GET", f"/open/v1/notes/{note['id']}/blocks/paragraph", headers=headers
    )
    assert current["content_version"] == 2
    assert current["block"]["content"][0]["text"] == "Before"
    assert (
        client.get(
            f"/open/v1/operations/{payload['operation_id']}", headers=headers
        ).status_code
        == 404
    )


def test_postgres_gui_rename_between_agent_read_and_metadata_cas_rolls_back_body(
    postgres_client, monkeypatch
):
    import asyncio
    from threading import Event
    from orbis_user_api.application import library_operations

    client = postgres_client
    headers, note, _token = setup_agent(client)
    current = request_data(
        client, "GET", f"/open/v1/notes/{note['id']}", headers=headers
    )
    # setup_document uses the same fixed isolated password as its fixture.
    login = request_data(
        client,
        "POST",
        "/auth/login",
        json={
            "email": "postgres-owner@example.com",
            "password": "isolated postgres validation password",
        },
    )
    gui_headers = {
        "Authorization": "Bearer " + login["access_token"],
        "X-Workspace-ID": headers["X-Workspace-ID"],
    }
    entered, release = Event(), Event()
    real_claim = library_operations.claim_note_metadata

    async def paused_claim(*args, **kwargs):
        entered.set()
        assert await asyncio.to_thread(release.wait, 10), (
            "Concurrent GUI rename did not reach the barrier"
        )
        return await real_claim(*args, **kwargs)

    monkeypatch.setattr(library_operations, "claim_note_metadata", paused_claim)
    payload = operation()
    payload["operations"].insert(
        0,
        {
            "type": "update_metadata",
            "expected_updated_at_ms": current["updated_at_ms"],
            "title": "Stale agent title",
        },
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            client.post,
            f"/open/v1/notes/{note['id']}/operations",
            headers=headers,
            json=payload,
        )
        assert entered.wait(10)
        try:
            renamed = request_data(
                client,
                "PATCH",
                f"/notes/{note['id']}",
                headers=gui_headers,
                json={"title": "Fresh GUI title"},
            )
            assert renamed["updated_at_ms"] > current["updated_at_ms"]
        finally:
            release.set()
        response = future.result(timeout=10)
    assert (
        response.status_code == 409
        and response.json()["code"] == "NOTE_METADATA_CONFLICT"
    )
    current = request_data(
        client, "GET", f"/open/v1/notes/{note['id']}", headers=headers
    )
    assert current["title"] == "Fresh GUI title" and current["content_version"] == 2
    block = request_data(
        client, "GET", f"/open/v1/notes/{note['id']}/blocks/paragraph", headers=headers
    )
    assert block["block"]["content"][0]["text"] == "Before"
    assert (
        client.get(
            f"/open/v1/operations/{payload['operation_id']}", headers=headers
        ).status_code
        == 404
    )
