from __future__ import annotations

import json
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, Query, Request
from sqlalchemy import Text, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_session
from orbis_user_api.application.block_content import BlockContentStore, at_version
from orbis_user_api.application.integration_auth import (
    IntegrationPrincipal,
    error,
    integration_principal,
)
from orbis_user_api.application.library_export import markdown_losses
from orbis_user_api.application.library_imports import import_limits
from orbis_user_api.application.library_operations import (
    create_library_note,
    execute_operations,
    receipt,
)
from orbis_user_api.application.library_reads import (
    current_content_version,
    legacy_changes,
    legacy_outline,
    native_snapshot_exists,
    readonly_content,
)
from orbis_user_api.domain.document_components import DOCUMENT_BLOCKS
from orbis_user_api.domain.note_content import V2_BLOCK_TYPES, blocks_to_markdown
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.note_block import NoteBlockDocument
from orbis_user_api.models.note_block import NoteBlockVersion as Block
from orbis_user_api.schemas.integration import (
    ImportBegin,
    LibraryCreate,
    OperationsRequest,
    ResolveRequest,
)
from orbis_user_api.schemas.note import NoteOut
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
)

router = ApiRouter(prefix="/open/v1", tags=["open-library"])
PROTOCOL_VERSION = "1.0"
MAX_PAGE_BYTES = 131072
MAX_EXPORT_BYTES = 8 * 1024 * 1024


@asynccontextmanager
async def content_errors():
    try:
        yield
    except NoteVersionConflict:
        raise error(
            409, "NOTE_VERSION_CONFLICT", "文档快照不可用或版本已变化"
        ) from None
    except NoteNotFound:
        raise error(404, "BLOCK_NOT_FOUND", "文档或块不存在") from None
    except NoteContentInvalid:
        raise error(422, "NOTE_CONTENT_INVALID", "文档结构无效") from None


def note_payload(note: Note) -> dict:
    return NoteOut.model_validate(note).model_dump(mode="json")


@router.get("/capabilities")
async def capabilities(
    request: Request,
    principal: IntegrationPrincipal = Depends(integration_principal),
) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "content_schema": "shallow-blocks-2",
        "permissions": principal.effective_permissions(),
        "scope": {
            "workspace_id": principal.workspace.id,
            "notebook_id": principal.token.notebook_id,
            "note_id": principal.token.note_id,
        },
        "limits": {
            "page_blocks": 64,
            "page_bytes": MAX_PAGE_BYTES,
            "operations": 100,
            "request_bytes": 1048576,
            "export_bytes": MAX_EXPORT_BYTES,
        },
        "operations": [
            "update_block",
            "replace_text",
            "insert_blocks",
            "move_block",
            "delete_block",
            "update_metadata",
        ],
        "features": {
            "create": True,
            "preview": True,
            "idempotency": True,
            "markdown_export": True,
            "files": True,
            "live_shares": True,
            "sites": False,
            "knowledge_base": False,
            "datasets": False,
            "large_markdown_import": True,
        },
        "imports": import_limits(request.app.state.settings),
        "receipt_retention": "until token history is administratively purged",
    }


@router.get("/me")
async def me(principal: IntegrationPrincipal = Depends(integration_principal)) -> dict:
    return {
        "user_id": principal.user.id,
        "display_name": principal.user.display_name,
        "token_id": principal.token.id,
        "token_name": principal.token.name,
        "workspace_id": principal.workspace.id,
        "role": principal.membership.role,
        "permissions": principal.effective_permissions(),
    }


@router.get("/workspaces")
async def workspaces(
    principal: IntegrationPrincipal = Depends(integration_principal),
) -> dict:
    return {
        "items": [
            {
                "id": principal.workspace.id,
                "name": principal.workspace.name,
                "role": principal.membership.role,
            }
        ],
        "next_cursor": None,
        "has_more": False,
    }


@router.get("/notebooks")
async def notebooks(
    limit: int = Query(default=20, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    principal.require("notes:read")
    filters = [
        Notebook.workspace_id == principal.workspace.id,
        Notebook.status == "active",
        NoteGroup.status == "active",
    ]
    if principal.token.notebook_id:
        filters.append(Notebook.id == principal.token.notebook_id)
    if principal.token.note_id:
        note = await principal.note(principal.token.note_id, session)
        filters.append(Notebook.id == note.notebook_id)
    rows = list(
        await session.scalars(
            select(Notebook)
            .join(NoteGroup, NoteGroup.id == Notebook.group_id)
            .where(*filters)
            .order_by(Notebook.created_at_ms, Notebook.id)
            .offset(cursor)
            .limit(limit + 1)
        )
    )
    return {
        "items": [
            {"id": row.id, "title": row.title, "workspace_id": row.workspace_id}
            for row in rows[:limit]
        ],
        "next_cursor": cursor + limit if len(rows) > limit else None,
        "has_more": len(rows) > limit,
    }


async def list_notes_data(
    principal, session, limit, cursor, query=None, notebook_id=None
):
    principal.require("notes:read")
    filters = [
        *principal.filters(),
        Notebook.status == "active",
        NoteGroup.status == "active",
    ]
    if notebook_id:
        filters.append(Note.notebook_id == notebook_id)
    if query:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped.lower()}%"
        body_match = (
            select(Block.id)
            .where(
                Block.note_id == Note.id,
                Block.valid_to.is_(None),
                func.lower(Block.plain_text).like(pattern, escape="\\"),
            )
            .exists()
        )
        legacy_match = (
            select(NoteContent.id)
            .where(
                NoteContent.note_id == Note.id,
                func.lower(NoteContent.plain_text).like(pattern, escape="\\"),
                ~select(NoteBlockDocument.id)
                .where(NoteBlockDocument.note_id == Note.id)
                .exists(),
            )
            .exists()
        )
        filters.append(
            or_(
                func.lower(Note.title).like(pattern, escape="\\"),
                body_match,
                legacy_match,
            )
        )
    rows = list(
        await session.scalars(
            select(Note)
            .join(Notebook, Notebook.id == Note.notebook_id)
            .join(NoteGroup, NoteGroup.id == Notebook.group_id)
            .where(*filters)
            .order_by(Note.created_at_ms, Note.id)
            .offset(cursor)
            .limit(limit + 1)
        )
    )
    items = [note_payload(row) for row in rows[:limit]]
    if query:
        from orbis_user_api.application.library_search import body_anchors

        anchors = await body_anchors([row.id for row in rows[:limit]], query, session)
        items = [
            {**item, **anchors.get(UUID(item["id"]), {"matches": []})} for item in items
        ]
    return {
        "items": items,
        "next_cursor": cursor + limit if len(rows) > limit else None,
        "has_more": len(rows) > limit,
    }


@router.get("/notes")
async def notes(
    limit: int = Query(default=20, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    notebook_id: UUID | None = None,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await list_notes_data(
        principal, session, limit, cursor, notebook_id=notebook_id
    )


@router.get("/search")
async def search(
    q: str = Query(min_length=1, max_length=240),
    limit: int = Query(default=20, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await list_notes_data(principal, session, limit, cursor, q)


@router.post("/resolve")
async def resolve(
    payload: ResolveRequest,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if payload.note_id:
        note = await principal.note(payload.note_id, session)
        return {"items": [note_payload(note)], "ambiguous": False}
    principal.require("notes:read")
    rows = list(
        await session.scalars(
            select(Note)
            .join(Notebook, Notebook.id == Note.notebook_id)
            .join(NoteGroup, NoteGroup.id == Notebook.group_id)
            .where(
                *principal.filters(),
                Note.title == payload.title,
                Notebook.status == "active",
                NoteGroup.status == "active",
            )
            .order_by(Note.id)
            .limit(21)
        )
    )
    return {
        "items": [note_payload(row) for row in rows[:20]],
        "ambiguous": len(rows) > 1,
        "truncated": len(rows) > 20,
    }


@router.post("/notes", status_code=201)
async def create(
    payload: LibraryCreate,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await create_library_note(principal, payload, session)


@router.get("/notes/{note_id}")
async def get_note(
    note_id: UUID,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        version = await current_content_version(note, session)
    return {**note_payload(note), "content_version": version}


@router.get("/notes/{note_id}/outline")
async def outline(
    note_id: UUID,
    version: int | None = Query(default=None, ge=1),
    limit: int = Query(default=32, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        version = version or await current_content_version(note, session)
        if not await native_snapshot_exists(note_id, version, session):
            return await legacy_outline(note, version, cursor, limit, session)
        rows = (
            await session.execute(
                select(
                    Block.block_id,
                    Block.parent_id,
                    Block.payload,
                    Block.plain_text,
                    Block.valid_from,
                )
                .where(
                    Block.note_id == note_id,
                    Block.block_type == "heading",
                    at_version(version),
                )
                .order_by(Block.parent_id, Block.position, Block.block_id)
                .offset(cursor)
                .limit(limit + 1)
            )
        ).all()
    return {
        "note_id": note_id,
        "content_version": version,
        "items": [
            {
                "id": row.block_id,
                "parent_id": row.parent_id,
                "level": row.payload.get("props", {}).get("level", 1),
                "text": row.plain_text[:256],
                "block_revision": row.valid_from,
            }
            for row in rows[:limit]
        ],
        "next_cursor": cursor + limit if len(rows) > limit else None,
        "has_more": len(rows) > limit,
    }


@router.get("/notes/{note_id}/blocks")
async def blocks(
    note_id: UUID,
    parent_id: str | None = None,
    version: int | None = Query(default=None, ge=1),
    limit: int = Query(default=32, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        page = await BlockContentStore(session, note).children(
            parent_id=parent_id,
            offset=cursor,
            limit=limit,
            version=version,
            max_bytes=MAX_PAGE_BYTES,
        )
    return {**page, "next_cursor": page["next_offset"] if page["has_more"] else None}


@router.get("/notes/{note_id}/blocks/{block_id}")
async def block(
    note_id: UUID,
    block_id: str,
    version: int | None = Query(default=None, ge=1),
    min_version: int | None = Query(default=None, ge=1),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        result = await BlockContentStore(session, note).block(block_id, version=version)
    if min_version and result["content_version"] < min_version:
        raise error(409, "PROJECTION_NOT_READY", "读取版本尚未满足写入回执")
    row = await session.scalar(
        select(Block.valid_from).where(
            Block.note_id == note_id,
            Block.block_id == block_id,
            at_version(result["content_version"]),
        )
    )
    result["block_revision"] = row
    return result


@router.get("/notes/{note_id}/export")
async def export(
    note_id: UUID,
    version: int = Query(ge=1),
    format: str = Query(default="json", pattern="^(json|markdown)$"),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        size = await session.scalar(
            select(func.sum(func.length(func.cast(Block.payload, Text)))).where(
                Block.note_id == note_id, at_version(version)
            )
        )
        if (size or 0) > MAX_EXPORT_BYTES:
            raise error(
                413,
                "EXPORT_BUDGET_EXCEEDED",
                "文档超过同步导出大小限制，请分页读取 JSON 内容",
            )
        content = await readonly_content(note, version, session)
    encoded = json.dumps(content.blocks, ensure_ascii=False).encode()
    if len(encoded) > MAX_EXPORT_BYTES:
        raise error(
            413,
            "EXPORT_BUDGET_EXCEEDED",
            "文档超过同步导出大小限制，请分页读取 JSON 内容",
        )
    unsupported = (
        markdown_losses(note_id, content.blocks) if format == "markdown" else []
    )
    return {
        "note_id": note_id,
        "content_version": version,
        "format": format,
        "complete": True,
        "content": blocks_to_markdown(content.blocks)
        if format == "markdown"
        else content.blocks,
        "losses": unsupported,
        "preserves_block_ids": format == "json",
    }


@router.get("/notes/{note_id}/changes")
async def changes(
    note_id: UUID,
    since_version: int = Query(ge=1),
    version: int | None = Query(default=None, ge=1),
    limit: int = Query(default=32, ge=1, le=64),
    cursor: int = Query(default=0, ge=0),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    note = await principal.note(note_id, session)
    async with content_errors():
        target = version or await current_content_version(note, session)
    if target < since_version:
        raise error(422, "CHANGE_VERSION_INVALID", "目标版本不能早于变化基线")
    if not await native_snapshot_exists(
        note_id, since_version, session
    ) or not await native_snapshot_exists(note_id, target, session):
        async with content_errors():
            return await legacy_changes(
                note, since_version, target, cursor, limit, session
            )
    changed_ids = (
        select(Block.block_id)
        .where(
            Block.note_id == note_id,
            or_(
                (Block.valid_from > since_version) & (Block.valid_from <= target),
                (Block.valid_to > since_version) & (Block.valid_to <= target),
            ),
        )
        .distinct()
        .order_by(Block.block_id)
        .offset(cursor)
        .limit(limit + 1)
    )
    ids = list(await session.scalars(changed_ids))
    active = list(
        await session.scalars(
            select(Block).where(
                Block.note_id == note_id,
                Block.block_id.in_(ids[:limit]),
                at_version(target),
            )
        )
    )
    by_id = {row.block_id: row for row in active}
    return {
        "note_id": note_id,
        "since_version": since_version,
        "content_version": target,
        "items": [
            {
                "id": identifier,
                "change": "upsert" if identifier in by_id else "deleted",
                "block_revision": by_id[identifier].valid_from
                if identifier in by_id
                else None,
            }
            for identifier in ids[:limit]
        ],
        "next_cursor": cursor + limit if len(ids) > limit else None,
        "has_more": len(ids) > limit,
    }


@router.post("/notes/{note_id}/operations/preview")
async def preview(
    note_id: UUID,
    payload: OperationsRequest,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await execute_operations(principal, note_id, payload, session, preview=True)


@router.post("/notes/{note_id}/operations")
async def apply(
    note_id: UUID,
    payload: OperationsRequest,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await execute_operations(principal, note_id, payload, session)


@router.get("/operations/{operation_id}")
async def operation_result(
    operation_id: UUID,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await receipt(principal, operation_id, session)
    if result is None:
        raise error(404, "OPERATION_NOT_FOUND", "尚未找到已提交的操作结果")
    return result


@router.get("/schema")
async def schema(
    principal: IntegrationPrincipal = Depends(integration_principal),
) -> dict:
    return {
        "operations": OperationsRequest.model_json_schema(),
        "create": LibraryCreate.model_json_schema(),
        "import_begin": ImportBegin.model_json_schema(),
        "content": {
            "schema_version": 2,
            "editor": "blocknote",
            "block_types": sorted(V2_BLOCK_TYPES),
            "components": DOCUMENT_BLOCKS,
            "shallow_block_example": {
                "id": "stable-block-id",
                "type": "paragraph",
                "props": {},
                "content": [
                    {"type": "text", "text": "Example", "styles": {"bold": True}}
                ],
            },
            "children": "Read child descriptors and page separately; omit children from write payloads",
            "file_reference": "orbis-file:{file_id}",
        },
        "token_scope": "Explicit workspace; optional notebook or exact note; token permissions intersect current membership",
    }


from orbis_user_api.api import (
    open_library_files,
    open_library_imports,
    open_library_shares,
)

router.include_router(open_library_files.router)
router.include_router(open_library_shares.router)

router.include_router(open_library_imports.router)
