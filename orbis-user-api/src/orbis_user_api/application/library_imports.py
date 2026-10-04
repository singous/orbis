"""Bounded import transport with persistent chunks and atomic final publication."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path

from sqlalchemy import select, update
from starlette.concurrency import run_in_threadpool

from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.integration_auth import IntegrationPrincipal, error
from orbis_user_api.application.library_operations import (
    create_library_note,
    request_digest,
)
from orbis_user_api.application.notes import _get_active_notebook, _validate_parent
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.domain.note_content import InvalidNoteContent, markdown_to_blocks
from orbis_user_api.models.integration import (
    IntegrationImport,
    IntegrationImportChunk,
    IntegrationOperation,
    IntegrationToken,
)
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.schemas.integration import ImportBegin, LibraryCreate
from orbis_user_api.services.exceptions import NotebookNotFound, NoteParentInvalid

DEFAULT_IMPORT_BYTES = 32 * 1024 * 1024
DEFAULT_CHUNK_BYTES = 256 * 1024
MAX_CONCURRENT_CODECS = 2
logger = logging.getLogger(__name__)


def import_limits(settings):
    return {
        "max_bytes": getattr(
            settings, "integration_import_max_bytes", DEFAULT_IMPORT_BYTES
        ),
        "chunk_bytes": getattr(
            settings, "integration_import_chunk_bytes", DEFAULT_CHUNK_BYTES
        ),
    }


def job_registry(app):
    if not hasattr(app.state, "integration_import_jobs"):
        app.state.integration_import_jobs = {}
        app.state.integration_import_gate = asyncio.Semaphore(MAX_CONCURRENT_CODECS)
    return app.state.integration_import_jobs


def import_public(state: IntegrationImport, app=None):
    job = job_registry(app).get(state.id) if app is not None else None
    return {
        "import_id": str(state.id),
        "operation_id": str(state.operation_id),
        "status": state.status,
        "total_bytes": state.total_bytes,
        "received_bytes": state.received_bytes,
        "source_sha256": state.source_sha256,
        "result": state.result or None,
        "failure_code": state.failure_code,
        "job_active": bool(job is not None and not job.done()),
    }


async def authorize_target(principal, notebook_id, parent_id, session):
    principal.require("notes:write")
    if principal.token.note_id or (
        principal.token.notebook_id and principal.token.notebook_id != notebook_id
    ):
        raise error(403, "INTEGRATION_SCOPE_FORBIDDEN", "导入目标不在令牌授权范围内")
    try:
        await _get_active_notebook(notebook_id, principal.workspace.id, session)
        await _validate_parent(parent_id, notebook_id, principal.workspace.id, session)
    except (NotebookNotFound, NoteParentInvalid):
        raise error(
            404, "INTEGRATION_SCOPE_NOT_FOUND", "笔记本或父文档已不可用"
        ) from None


async def owned_import(import_id, principal, session, *, lock=False):
    statement = select(IntegrationImport).where(
        IntegrationImport.id == import_id,
        IntegrationImport.token_id == principal.token.id,
        IntegrationImport.workspace_id == principal.workspace.id,
    )
    if lock:
        statement = statement.with_for_update()
    state = await session.scalar(statement.execution_options(populate_existing=True))
    if state is None:
        raise error(404, "IMPORT_NOT_FOUND", "导入会话不存在或不在授权范围内")
    await authorize_target(principal, state.notebook_id, state.parent_id, session)
    return state


async def begin_import(payload: ImportBegin, principal, session, settings, app):
    await authorize_target(principal, payload.notebook_id, payload.parent_id, session)
    limits = import_limits(settings)
    if payload.total_bytes > limits["max_bytes"]:
        raise error(
            413, "IMPORT_BUDGET_EXCEEDED", "Markdown 超出当前实例导入预算", limits
        )
    digest = request_digest("import", None, payload)
    await session.scalar(
        select(IntegrationToken)
        .where(IntegrationToken.id == principal.token.id)
        .with_for_update()
    )
    existing = await session.scalar(
        select(IntegrationImport).where(
            IntegrationImport.token_id == principal.token.id,
            IntegrationImport.operation_id == payload.operation_id,
        )
    )
    if existing:
        if existing.request_hash != digest:
            raise error(409, "IDEMPOTENCY_KEY_REUSED", "导入操作 ID 已用于不同内容")
        return {**import_public(existing, app), "chunk_bytes": limits["chunk_bytes"]}
    prior = await session.scalar(
        select(IntegrationOperation.id).where(
            IntegrationOperation.token_id == principal.token.id,
            IntegrationOperation.operation_id == payload.operation_id,
        )
    )
    if prior:
        raise error(409, "IDEMPOTENCY_KEY_REUSED", "操作 ID 已用于其他写入")
    state = IntegrationImport(
        id=new_uuidv7(),
        token_id=principal.token.id,
        operation_id=payload.operation_id,
        workspace_id=principal.workspace.id,
        notebook_id=payload.notebook_id,
        parent_id=payload.parent_id,
        title=payload.title,
        request_hash=digest,
        source_sha256=payload.source_sha256,
        total_bytes=payload.total_bytes,
    )
    session.add(state)
    await session.commit()
    return {**import_public(state, app), "chunk_bytes": limits["chunk_bytes"]}


def persist_chunk(path: Path, data: bytes, expected_sha: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha:
            raise error(422, "IMPORT_CHUNK_CORRUPT", "持久化块校验失败")
        return
    temporary = path.with_suffix(".part-" + str(new_uuidv7()))
    try:
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


async def upload_chunk(
    import_id, offset, sha256, data, principal, session, storage, settings, app
):
    # Auth telemetry is not held while an import row is locked; finalizers use
    # import→token lock order when publishing an operation receipt.
    await session.commit()
    state = await owned_import(import_id, principal, session, lock=True)
    if (
        not data
        or len(data) > import_limits(settings)["chunk_bytes"]
        or hashlib.sha256(data).hexdigest() != sha256
    ):
        raise error(422, "IMPORT_CHUNK_INVALID", "导入块大小或 SHA-256 不正确")
    existing = await session.scalar(
        select(IntegrationImportChunk).where(
            IntegrationImportChunk.import_id == import_id,
            IntegrationImportChunk.offset_bytes == offset,
        )
    )
    if existing:
        if existing.sha256 != sha256 or existing.size_bytes != len(data):
            raise error(409, "IMPORT_CHUNK_CONFLICT", "相同 offset 已用于其他块")
        return {**import_public(state, app), "duplicate": True}
    if state.status != "uploading":
        raise error(409, "IMPORT_NOT_UPLOADING", "此导入会话已进入处理阶段")
    if offset != state.received_bytes or offset + len(data) > state.total_bytes:
        raise error(
            409,
            "IMPORT_OFFSET_CONFLICT",
            "请从已确认的 offset 继续",
            {"expected_offset": state.received_bytes},
        )
    claimed = await session.execute(
        update(IntegrationImport)
        .where(
            IntegrationImport.id == import_id,
            IntegrationImport.received_bytes == offset,
            IntegrationImport.status == "uploading",
        )
        .values(received_bytes=offset + len(data), updated_at_ms=now_ms())
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await session.rollback()
        from orbis_user_api.application.library_operations import refresh_principal

        await refresh_principal(principal, session)
        state = await owned_import(import_id, principal, session)
        previous = await session.scalar(
            select(IntegrationImportChunk).where(
                IntegrationImportChunk.import_id == import_id,
                IntegrationImportChunk.offset_bytes == offset,
            )
        )
        if previous and previous.sha256 == sha256 and previous.size_bytes == len(data):
            return {**import_public(state, app), "duplicate": True}
        raise error(
            409,
            "IMPORT_OFFSET_CONFLICT",
            "此 offset 已发生并发更新",
            {"expected_offset": state.received_bytes},
        )
    key = f"imports/{state.workspace_id}/{state.id}/{offset}-{sha256}.chunk"
    await run_in_threadpool(persist_chunk, storage.resolve(key), data, sha256)
    session.add(
        IntegrationImportChunk(
            import_id=state.id,
            offset_bytes=offset,
            size_bytes=len(data),
            sha256=sha256,
            storage_key=key,
        )
    )
    await session.commit()
    await session.refresh(state)
    return import_public(state, app)


async def worker_principal(state, session):
    token = await session.get(IntegrationToken, state.token_id, populate_existing=True)
    if (
        token is None
        or token.revoked_at_ms is not None
        or (token.expires_at_ms and token.expires_at_ms <= now_ms())
    ):
        raise error(401, "INTEGRATION_TOKEN_INVALID", "导入令牌已失效")
    user = await session.get(User, token.owner_id, populate_existing=True)
    workspace = await session.get(Workspace, state.workspace_id, populate_existing=True)
    membership = await session.scalar(
        select(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == state.workspace_id,
            WorkspaceMember.user_id == token.owner_id,
            WorkspaceMember.status == "active",
        )
        .execution_options(populate_existing=True)
    )
    if (
        user is None
        or user.status != "active"
        or workspace is None
        or workspace.status != "active"
        or membership is None
    ):
        raise error(401, "INTEGRATION_ACCESS_REVOKED", "导入成员身份已失效")
    principal = IntegrationPrincipal(token, user, workspace, membership)
    await authorize_target(principal, state.notebook_id, state.parent_id, session)
    return principal


def decode_import(chunks, storage, expected_bytes, expected_sha):
    source = bytearray()
    cursor = 0
    for offset, size, sha, key in chunks:
        data = storage.resolve(key).read_bytes()
        if (
            offset != cursor
            or len(data) != size
            or hashlib.sha256(data).hexdigest() != sha
        ):
            raise error(422, "IMPORT_CHUNK_CORRUPT", "导入块不完整或校验失败")
        source.extend(data)
        cursor += size
    if cursor != expected_bytes or hashlib.sha256(source).hexdigest() != expected_sha:
        raise error(
            422, "IMPORT_SOURCE_DIGEST_MISMATCH", "完整 Markdown 摘要或大小校验失败"
        )
    try:
        return markdown_to_blocks(source.decode("utf-8-sig"))
    except (UnicodeError, InvalidNoteContent):
        raise error(
            422, "IMPORT_CODEC_INVALID", "Markdown 不是可解析的 UTF-8 文档"
        ) from None


async def run_import(app, import_id):
    try:
        async with app.state.integration_import_gate:
            async with app.state.session_factory() as session:
                state = await session.scalar(
                    select(IntegrationImport)
                    .where(IntegrationImport.id == import_id)
                    .with_for_update()
                )
                if state is None or state.status == "committed":
                    return
                principal = await worker_principal(state, session)
                rows = (
                    await session.execute(
                        select(
                            IntegrationImportChunk.offset_bytes,
                            IntegrationImportChunk.size_bytes,
                            IntegrationImportChunk.sha256,
                            IntegrationImportChunk.storage_key,
                        )
                        .where(IntegrationImportChunk.import_id == import_id)
                        .order_by(IntegrationImportChunk.offset_bytes)
                    )
                ).all()
                blocks = await run_in_threadpool(
                    decode_import,
                    rows,
                    app.state.storage,
                    state.total_bytes,
                    state.source_sha256,
                )
                principal = await worker_principal(state, session)
                payload = LibraryCreate(
                    operation_id=state.operation_id,
                    notebook_id=state.notebook_id,
                    parent_id=state.parent_id,
                    title=state.title,
                )
                result = await create_library_note(
                    principal,
                    payload,
                    session,
                    prepared_blocks=blocks,
                    digest_override=state.request_hash,
                    commit=False,
                )
                state = await session.get(
                    IntegrationImport, import_id, populate_existing=True
                )
                state.status, state.result, state.failure_code, state.updated_at_ms = (
                    "committed",
                    result,
                    None,
                    now_ms(),
                )
                await session.commit()
    except asyncio.CancelledError:
        # A stopped process leaves resumable chunks and a pending phase; it must
        # never manufacture a failed or successful document result on shutdown.
        raise
    except Exception as exc:
        code = exc.code if isinstance(exc, ApiError) else "IMPORT_PROCESSING_FAILED"
        logger.error(
            "Markdown import failed",
            extra={
                "import_id": str(import_id),
                "failure_code": code,
                "exception_type": type(exc).__name__,
            },
        )
        async with app.state.session_factory() as session:
            state = await session.get(IntegrationImport, import_id)
            if state and state.status != "committed":
                state.status, state.failure_code, state.updated_at_ms = (
                    "failed",
                    code,
                    now_ms(),
                )
                await session.commit()


async def finalize_import(import_id, principal, session, app):
    await session.commit()
    state = await owned_import(import_id, principal, session, lock=True)
    if state.status == "committed":
        return import_public(state, app)
    if state.status == "failed":
        raise error(422, state.failure_code or "IMPORT_FAILED", "导入未能生成文档")
    if state.received_bytes != state.total_bytes:
        raise error(
            409,
            "IMPORT_UPLOAD_INCOMPLETE",
            "请先上传剩余 Markdown 块",
            {"received_bytes": state.received_bytes},
        )
    registry = job_registry(app)
    task = registry.get(import_id)
    if task is not None and not task.done():
        return import_public(state, app)
    state.status, state.updated_at_ms = "finalizing", now_ms()
    await session.commit()
    task = asyncio.create_task(
        run_import(app, import_id), name=f"orbis-import-{import_id}"
    )
    registry[import_id] = task

    def clear(completed):
        if registry.get(import_id) is completed:
            registry.pop(import_id, None)

    task.add_done_callback(clear)
    return import_public(state, app)
