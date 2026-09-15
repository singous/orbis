"""Opt-in PostgreSQL checks; each test owns and removes a random schema.

Set ORBIS_TEST_POSTGRES_URL to an asyncpg URL whose database starts with
orbis_test_. The normal suite skips these checks without that explicit URL.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.settings import Settings
from orbis_user_api.main import create_app
from orbis_user_api.models.note import NoteContent
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.sql import Select


@pytest.fixture()
def postgres_client(tmp_path: Path):
    database_url = os.environ.get("ORBIS_TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("Set ORBIS_TEST_POSTGRES_URL for isolated PostgreSQL validation")
    parsed = make_url(database_url)
    if parsed.drivername != "postgresql+asyncpg" or not (
        parsed.database or ""
    ).startswith("orbis_test_"):
        pytest.fail("PostgreSQL validation requires an orbis_test_ database")
    schema = f"orbis_test_{secrets.token_hex(8)}"

    async def schema_command(statement: str) -> None:
        engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(statement))
        finally:
            await engine.dispose()

    asyncio.run(schema_command(f'CREATE SCHEMA "{schema}"'))
    try:
        settings = Settings(
            _env_file=None,
            database_url=database_url,
            database_schema=schema,
            auto_create_tables=True,
            storage_dir=tmp_path / "storage",
            access_token_secret=secrets.token_urlsafe(48),
            refresh_token_secret=secrets.token_urlsafe(48),
            action_token_secret=secrets.token_urlsafe(48),
            mail_transport="disabled",
        )
        with TestClient(create_app(settings)) as client:
            yield client
    finally:
        asyncio.run(schema_command(f'DROP SCHEMA "{schema}" CASCADE'))


def request_data(client: TestClient, method: str, path: str, status=200, **kwargs):
    response = client.request(method, path, **kwargs)
    assert response.status_code == status, response.text
    return response.json()["data"]


def setup_document(client: TestClient):
    owner = request_data(
        client,
        "POST",
        "/setup",
        201,
        json={
            "email": "postgres-owner@example.com",
            "password": "isolated postgres validation password",
            "display_name": "PostgreSQL Owner",
        },
    )
    headers = {"Authorization": f"Bearer {owner['access_token']}"}
    notebook = request_data(
        client, "POST", "/notebooks", 201, headers=headers, json={"title": "PG Notes"}
    )
    note = request_data(
        client,
        "POST",
        "/notes",
        201,
        headers=headers,
        json={"notebook_id": notebook["id"], "title": "PG Document"},
    )
    return headers, note


def content(value: str, format_version=1) -> dict[str, Any]:
    if format_version == 1:
        return {
            "schema_version": 1,
            "editor": "tiptap",
            "doc": {
                "type": "doc",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": value}]}
                ],
            },
        }
    return {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "private-editor-id",
                "type": "paragraph",
                "props": {},
                "content": [{"type": "text", "text": value, "styles": {}}],
            }
        ],
    }


def test_history_restore_and_public_release_lifecycle_on_postgres(postgres_client):
    client = postgres_client
    headers, note = setup_document(client)
    content_path = f"/notes/{note['id']}/content"
    history_path = f"/notes/{note['id']}/revisions"
    first = request_data(
        client,
        "PUT",
        content_path,
        headers=headers,
        json={"expected_version": 1, "blocks": content("Original v1")},
    )
    assert first["content_version"] == 2
    history = request_data(client, "GET", history_path, headers=headers)["items"]
    original_revision = history[0]
    second = request_data(
        client,
        "PUT",
        content_path,
        headers=headers,
        json={"expected_version": 2, "blocks": content("Original v2", 2)},
    )
    assert second["content_version"] == 3 and second["blocks"]["schema_version"] == 2
    before = request_data(client, "GET", history_path, headers=headers)
    conflict = client.put(
        content_path,
        headers=headers,
        json={"expected_version": 2, "blocks": content("Rejected")},
    )
    assert conflict.status_code == 409
    assert request_data(client, "GET", history_path, headers=headers) == before
    restore_path = f"{history_path}/{original_revision['id']}/restore"
    restored = request_data(
        client, "POST", restore_path, headers=headers, json={"expected_version": 3}
    )
    assert restored["content_version"] == 4 and restored["plain_text"] == "Original v1"
    assert (
        client.post(
            restore_path, headers=headers, json={"expected_version": 3}
        ).status_code
        == 409
    )
    history = request_data(client, "GET", history_path, headers=headers)["items"]
    assert [item["content_version"] for item in history] == [4, 3, 2, 1]
    previous = request_data(
        client, "GET", f"{history_path}/{history[1]['id']}", headers=headers
    )
    assert previous["plain_text"] == "Original v2"
    assert previous["blocks"]["schema_version"] == 2

    comment = request_data(
        client,
        "POST",
        f"/notes/{note['id']}/comments",
        201,
        headers=headers,
        json={"body": "PostgreSQL discussion"},
    )
    resolved = request_data(
        client,
        "PATCH",
        f"/notes/{note['id']}/comments/{comment['id']}",
        headers=headers,
        json={"is_resolved": True},
    )
    assert resolved["is_resolved"] is True

    config = {
        "name": "PG Handbook",
        "slug": "pg-handbook",
        "description": "Original",
        "site_kind": "handbook",
        "accent_color": "#0f766e",
        "navigation": [
            {
                "note_id": note["id"],
                "slug": "start",
                "title": "Start",
                "group": "Basics",
            }
        ],
    }
    site = request_data(client, "POST", "/sites", 201, headers=headers, json=config)
    site_path = f"/sites/{site['id']}"
    assert client.get("/public/sites/pg-handbook").status_code == 404
    assert client.get(f"{site_path}/preview").status_code == 401
    preview = request_data(client, "GET", f"{site_path}/preview", headers=headers)
    assert preview["pages"][0]["plain_text"] == "Original v1"
    release = request_data(client, "POST", f"{site_path}/publish", headers=headers)
    assert release["release_number"] == 1
    assert request_data(client, "GET", "/public/sites/pg-handbook") == release
    request_data(
        client,
        "PUT",
        content_path,
        headers=headers,
        json={"expected_version": 4, "blocks": content("Private draft v2", 2)},
    )
    changed = deepcopy(config)
    changed.update(name="New name", description="Draft", accent_color="#115e59")
    changed["navigation"][0].update(title="Draft navigation", slug="draft")
    request_data(
        client,
        "PUT",
        site_path,
        headers=headers,
        json={**changed, "expected_version": 1},
    )
    assert request_data(client, "GET", "/public/sites/pg-handbook") == release
    next_release = request_data(client, "POST", f"{site_path}/publish", headers=headers)
    assert next_release["release_number"] == 2
    assert next_release["pages"][0]["plain_text"] == "Private draft v2"
    assert next_release["pages"][0]["slug"] == "draft"
    assert next_release["name"] == "New name"
    releases = request_data(client, "GET", f"{site_path}/releases", headers=headers)
    assert releases["pagination"]["total"] == 2
    request_data(
        client,
        "POST",
        f"{site_path}/releases/{release['release_id']}/activate",
        headers=headers,
    )
    assert request_data(client, "GET", "/public/sites/pg-handbook") == release
    request_data(client, "POST", f"{site_path}/unpublish", headers=headers)
    assert client.get("/public/sites/pg-handbook").status_code == 404
    for record, timestamp in [(site, "created_at_ms"), (comment, "created_at_ms")]:
        assert UUID(record["id"]).version == 7
        assert 1_700_000_000_000 < record[timestamp] < 4_000_000_000_000
    assert UUID(release["release_id"]).version == 7
    assert 1_700_000_000_000 < release["published_at_ms"] < 4_000_000_000_000


def test_postgres_concurrent_writes_keep_one_winner_without_orphan_revisions(
    postgres_client, monkeypatch
):
    client = postgres_client
    headers, note = setup_document(client)
    original_execute = AsyncSession.execute
    readers = 0
    barrier = asyncio.Event()

    async def read_together(self, statement, *args, **kwargs):
        nonlocal readers
        result = await original_execute(self, statement, *args, **kwargs)
        if (
            isinstance(statement, Select)
            and statement.column_descriptions[0].get("entity") is NoteContent
        ):
            readers += 1
            if readers == 2:
                barrier.set()
            if readers <= 2:
                await asyncio.wait_for(barrier.wait(), timeout=10)
        return result

    monkeypatch.setattr(AsyncSession, "execute", read_together)
    path = f"/notes/{note['id']}/content"
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda value: client.put(
                    path,
                    headers=headers,
                    json={"expected_version": 1, "blocks": content(value)},
                ),
                ["Writer A", "Writer B"],
            )
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(
        response.json()["data"] for response in responses if response.status_code == 200
    )
    current = request_data(client, "GET", path, headers=headers)
    assert current["plain_text"] == winner["plain_text"]
    assert current["content_version"] == 2
    history = request_data(
        client, "GET", f"/notes/{note['id']}/revisions", headers=headers
    )
    assert [item["content_version"] for item in history["items"]] == [2, 1]


def test_postgres_native_types_and_server_defaults(postgres_client):
    async def inspect_schema():
        async with postgres_client.app.state.engine.begin() as connection:
            columns = (
                (
                    await connection.execute(
                        text(
                            "SELECT table_name, column_name, data_type, column_default "
                            "FROM information_schema.columns WHERE table_schema=current_schema()"
                        )
                    )
                )
                .mappings()
                .all()
            )
            by_column = {
                (row["table_name"], row["column_name"]): row for row in columns
            }
            for row in columns:
                if row["column_name"] == "id" or row["column_name"].endswith("_id"):
                    assert row["data_type"] == "uuid", row
                if row["column_name"].endswith("_at_ms"):
                    assert row["data_type"] == "bigint", row
            for table, column in [
                ("note_contents", "blocks"),
                ("note_revisions", "blocks"),
                ("sites", "navigation"),
                ("site_releases", "snapshot"),
            ]:
                assert by_column[(table, column)]["data_type"] == "jsonb"
                assert by_column[(table, column)]["column_default"] is not None
            site = (
                (
                    await connection.execute(
                        text(
                            "INSERT INTO sites (id, workspace_id, slug) VALUES (:id, :workspace, 'server-defaults') "
                            "RETURNING navigation, config_version, release_sequence, site_kind, accent_color, created_at_ms, updated_at_ms"
                        ),
                        {"id": new_uuidv7(), "workspace": new_uuidv7()},
                    )
                )
                .mappings()
                .one()
            )
            assert dict(site) == {
                "navigation": [],
                "config_version": 1,
                "release_sequence": 0,
                "site_kind": "knowledge",
                "accent_color": "#0f766e",
                "created_at_ms": 0,
                "updated_at_ms": 0,
            }
            comment = (
                (
                    await connection.execute(
                        text(
                            "INSERT INTO note_comments (id, workspace_id, note_id, author_id) "
                            "VALUES (:id, :workspace, :note, :author) RETURNING body, is_resolved, created_at_ms"
                        ),
                        {
                            key: new_uuidv7()
                            for key in ["id", "workspace", "note", "author"]
                        },
                    )
                )
                .mappings()
                .one()
            )
            assert dict(comment) == {
                "body": "",
                "is_resolved": False,
                "created_at_ms": 0,
            }

    postgres_client.portal.call(inspect_schema)
