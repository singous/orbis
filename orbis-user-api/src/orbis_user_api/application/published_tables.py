"""Immutable release table rows, paged independently of the page body."""

from copy import deepcopy
from html import escape
from uuid import UUID

from sqlalchemy import insert, select

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.data_table import PublishedTable, PublishedTableRecord
from orbis_user_api.models.site import Site
from orbis_user_api.models.site_page import SiteReleasePage
from orbis_user_api.services.authorization import AuthorizationService, Capability
from orbis_user_api.services.exceptions import NoteNotFound

PUBLIC_TABLE_PAGE_SIZE = 100


def table_nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from table_nodes(item)
    elif isinstance(value, dict):
        if value.get("type") == "dataTable" and isinstance(
            value.get("table_snapshot"), dict
        ):
            yield value
        for key in ("blocks", "children"):
            yield from table_nodes(value.get(key, []))


def digest_content(blocks):
    normalized = deepcopy(blocks)
    for node in table_nodes(normalized):
        data = node["table_snapshot"]
        if "digest" in data:
            node["table_snapshot"] = {
                key: value
                for key, value in data.items()
                if key not in {"rows", "snapshot_id", "records_url", "offset"}
            }
    return normalized


async def persist_tables(session, site_id, body_id, blocks):
    result = deepcopy(blocks)
    for node in table_nodes(result):
        data = node["table_snapshot"]
        if data.get("snapshot_id"):
            # Reused projections may be attached to a new body after metadata
            # changes. Reuse the immutable rows through a new authorized header.
            previous = await session.get(PublishedTable, UUID(data["snapshot_id"]))
            if previous is None or previous.site_id != site_id:
                raise NoteNotFound
            rows = list(
                await session.scalars(
                    select(PublishedTableRecord.cells)
                    .where(PublishedTableRecord.snapshot_id == previous.id)
                    .order_by(PublishedTableRecord.position)
                )
            )
        else:
            rows = data.get("rows", [])
        identity = new_uuidv7()
        definition = {
            key: value
            for key, value in data.items()
            if key not in {"rows", "snapshot_id", "records_url", "offset"}
        }
        definition["total"] = len(rows)
        session.add(
            PublishedTable(
                id=identity,
                site_id=site_id,
                body_id=body_id,
                definition=definition,
                total=len(rows),
            )
        )
        for offset in range(0, len(rows), 200):
            await session.execute(
                insert(PublishedTableRecord),
                [
                    {
                        "snapshot_id": identity,
                        "position": offset + index,
                        "cells": cells,
                    }
                    for index, cells in enumerate(rows[offset : offset + 200])
                ],
            )
        node["table_snapshot"] = {
            **definition,
            "snapshot_id": str(identity),
            "rows": rows[:PUBLIC_TABLE_PAGE_SIZE],
            "offset": 0,
        }
    return result


def bind_urls(blocks, slug, release_id):
    result = deepcopy(blocks)
    for node in table_nodes(result):
        data = node["table_snapshot"]
        if data.get("snapshot_id"):
            data["records_url"] = (
                f"/public/sites/{slug}/table-snapshots/{data['snapshot_id']}?expected_release_id={release_id}"
            )
    return result


async def public_snapshot(session, slug, snapshot_id, expected_release_id=None):
    from orbis_user_api.application.site_delivery import active_release

    release = await active_release(slug, session, expected_release_id)
    snapshot = await session.scalar(
        select(PublishedTable)
        .join(
            SiteReleasePage,
            (SiteReleasePage.body_id == PublishedTable.body_id)
            & (SiteReleasePage.site_id == PublishedTable.site_id),
        )
        .where(
            PublishedTable.id == snapshot_id,
            SiteReleasePage.release_id == release.release_id,
            SiteReleasePage.site_id == release.site_id,
        )
    )
    if snapshot is None:
        raise NoteNotFound
    return snapshot, release.release_id


async def private_snapshot(session, snapshot_id, user):
    workspace, membership = await AuthorizationService.actor(user, session)
    AuthorizationService.require_capability(membership, Capability.RESOURCE_READ)
    snapshot = await session.scalar(
        select(PublishedTable)
        .join(Site, Site.id == PublishedTable.site_id)
        .where(PublishedTable.id == snapshot_id, Site.workspace_id == workspace.id)
    )
    if snapshot is None:
        raise NoteNotFound
    return snapshot


async def snapshot_page(session, snapshot, offset, limit):
    rows = list(
        await session.scalars(
            select(PublishedTableRecord.cells)
            .where(PublishedTableRecord.snapshot_id == snapshot.id)
            .order_by(PublishedTableRecord.position)
            .offset(offset)
            .limit(limit)
        )
    )
    return {
        **snapshot.definition,
        "snapshot_id": str(snapshot.id),
        "rows": rows,
        "total": snapshot.total,
        "offset": offset,
        "next_offset": offset + len(rows),
        "has_more": offset + len(rows) < snapshot.total,
    }


async def hydrate_for_export(session, blocks):
    result = deepcopy(blocks)
    for node in table_nodes(result):
        data = node["table_snapshot"]
        if data.get("snapshot_id"):
            snapshot = await session.get(PublishedTable, UUID(data["snapshot_id"]))
            if not snapshot:
                raise NoteNotFound
            node["table_snapshot"] = {
                **data,
                **await snapshot_page(session, snapshot, 0, snapshot.total),
            }
    return result


def snapshot_html(data, records_url):
    columns = "".join(
        f'<th scope="col">{escape(value)}</th>' for value in data["columns"]
    )
    rows = "".join(
        "<tr>" + "".join(f"<td>{escape(value)}</td>" for value in row) + "</tr>"
        for row in data["rows"]
    )
    links = []
    if data["offset"]:
        links.append(
            f'<a href="{escape(records_url + "&offset=" + str(max(0, data["offset"] - PUBLIC_TABLE_PAGE_SIZE)), quote=True)}">上一页</a>'
        )
    if data["has_more"]:
        links.append(
            f'<a href="{escape(records_url + "&offset=" + str(data["next_offset"]), quote=True)}">下一页</a>'
        )
    return (
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'
        + escape(data["title"])
        + "</title><style>body{font:16px/1.6 system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.5rem;text-align:left}nav{display:flex;gap:2rem}</style><h1>"
        + escape(data["title"])
        + f"</h1><p>{data['total']} 条记录</p><table><thead><tr>{columns}</tr></thead><tbody>{rows}</tbody></table><nav>"
        + "".join(links)
        + "</nav></html>"
    )
