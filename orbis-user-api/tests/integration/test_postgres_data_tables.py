"""Real PostgreSQL evidence for bounded table reads, sparse writes and conflicts."""

from concurrent.futures import ThreadPoolExecutor
from time import perf_counter
from uuid import UUID

import pytest
from sqlalchemy import insert, select, func
from test_postgres_base_mvp import (
    postgres_client as postgres_fixture,
    request_data,
    setup_document,
)

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.data_table import DataTableRecord

postgres_client = postgres_fixture


@pytest.mark.parametrize("count", [1000, 10000])
def test_postgres_ten_thousand_records_filter_page_single_write_and_race(
    postgres_client, count
):
    client = postgres_client
    headers, note = setup_document(client)
    base = f"/notes/{note['id']}"
    block = {
        "id": "table",
        "type": "dataTable",
        "props": {},
        "content": [],
        "children": [],
    }
    content = request_data(client, "GET", base + "/content", headers=headers)
    request_data(
        client,
        "PUT",
        base + "/content",
        headers=headers,
        json={
            "expected_version": content["content_version"],
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": [block]},
        },
    )
    created = request_data(
        client,
        "POST",
        base + "/tables",
        201,
        headers=headers,
        json={
            "operation_id": str(new_uuidv7()),
            "expected_document_version": content["content_version"] + 1,
            "block_id": "table",
        },
    )
    path = base + "/tables/" + created["table_id"]
    table = request_data(client, "GET", path, headers=headers)
    title, status, date = table["definition"]["fields"]
    identity = UUID(created["table_id"])
    records = [
        {
            "id": new_uuidv7(),
            "table_id": identity,
            "record_id": new_uuidv7(),
            "valid_from": 1,
            "values": {
                title["id"]: f"Row {index:05}",
                status["id"]: status["options"][index % 3]["id"],
                date["id"]: 1780000000000 + index * 1000,
            },
        }
        for index in range(count)
    ]

    async def populate():
        async with client.app.state.session_factory() as session:
            await session.execute(insert(DataTableRecord), records)
            await session.commit()

    client.portal.call(populate)
    started = perf_counter()
    page = request_data(
        client, "GET", path, headers=headers, params={"limit": 40, "offset": count - 50}
    )
    elapsed = perf_counter() - started
    assert page["total"] == count and len(page["records"]) == 40 and page["has_more"]
    assert len(str(page)) < 40000
    payload = {
        "operation_id": str(new_uuidv7()),
        "expected_document_version": created["content_version"],
        "expected_table_revision": 1,
        "upserts": [
            {
                "id": str(records[0]["record_id"]),
                "values": {title["id"]: "Updated one record"},
            }
        ],
    }
    first = request_data(client, "PATCH", path, headers=headers, json=payload)

    async def row_count():
        async with client.app.state.session_factory() as session:
            return await session.scalar(
                select(func.count())
                .select_from(DataTableRecord)
                .where(DataTableRecord.table_id == identity)
            )

    assert client.portal.call(row_count) == count + 1
    definition = table["definition"]
    definition["views"][0]["filters"] = [
        {"field_id": date["id"], "operator": "not_empty", "value": None}
    ]
    definition["views"][0]["sorts"] = [{"field_id": date["id"], "descending": True}]
    next_payload = {
        "operation_id": str(new_uuidv7()),
        "expected_document_version": first["content_version"],
        "expected_table_revision": first["table_revision"],
        "definition": definition,
    }
    second = request_data(client, "PATCH", path, headers=headers, json=next_payload)
    filtered = request_data(client, "GET", path, headers=headers, params={"limit": 10})
    assert (
        filtered["total"] == count
        and filtered["records"][0]["values"][title["id"]] == f"Row {count - 1:05}"
    )

    def write(index):
        return client.patch(
            path,
            headers=headers,
            json={
                "operation_id": str(new_uuidv7()),
                "expected_document_version": second["content_version"],
                "expected_table_revision": second["table_revision"],
                "upserts": [
                    {
                        "id": str(records[index + 1]["record_id"]),
                        "values": {title["id"]: f"Writer {index}"},
                    }
                ],
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(write, [0, 1]))
    assert sorted(results) == [200, 409]
    assert client.portal.call(row_count) == count + 2
    print(
        {
            "records": count,
            "page_rows": 40,
            "page_seconds": round(elapsed, 4),
            "concurrent_statuses": sorted(results),
        }
    )
