from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from sqlalchemy import case, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.errors import ApiError
from orbis_user_api.application.block_content import BlockContentStore, at_version
from orbis_user_api.application.integration_auth import IntegrationPrincipal, error
from orbis_user_api.application.notes import _get_active_notebook, _validate_parent
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.core.time import now_ms
from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    derive_plain_text,
    markdown_to_blocks,
)
from orbis_user_api.models.integration import IntegrationOperation, IntegrationToken
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.note_block import NoteBlockVersion as Block
from orbis_user_api.schemas.integration import (
    DeleteBlock,
    InsertBlocks,
    LibraryCreate,
    MoveBlock,
    OperationsRequest,
    ReplaceText,
    UpdateBlock,
    UpdateMetadata,
)
from orbis_user_api.services.exceptions import (
    NotebookNotFound,
    NoteContentInvalid,
    NoteNotFound,
    NoteParentInvalid,
    NoteVersionConflict,
)


def request_digest(action: str, note_id: UUID | None, payload) -> str:
    data = {
        "action": action,
        "note_id": str(note_id) if note_id else None,
        "payload": payload.model_dump(mode="json"),
    }
    return hashlib.sha256(
        json.dumps(
            data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


async def refresh_principal(
    principal: IntegrationPrincipal, session: AsyncSession
) -> None:
    for row in (
        principal.token,
        principal.user,
        principal.workspace,
        principal.membership,
    ):
        await session.refresh(row)


async def receipt(
    principal: IntegrationPrincipal,
    operation_id: UUID,
    session: AsyncSession,
    digest: str | None = None,
) -> dict | None:
    row = await session.scalar(
        select(IntegrationOperation).where(
            IntegrationOperation.token_id == principal.token.id,
            IntegrationOperation.operation_id == operation_id,
        )
    )
    if row is None:
        return None
    await principal.note(row.note_id, session)
    if digest is not None and row.request_hash != digest:
        raise error(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "操作 ID 已用于其他请求，请为新的业务操作生成新 ID",
        )
    return row.result


async def block_row(store: BlockContentStore, identifier: str, version: int):
    row = await store.session.scalar(
        select(Block).where(
            Block.note_id == store.note.id,
            Block.block_id == identifier,
            at_version(version),
        )
    )
    if row is not None:
        return row
    try:
        value = await store.block(identifier, version=version)
    except NoteNotFound:
        raise error(404, "BLOCK_NOT_FOUND", "目标块不存在") from None
    block = {key: item for key, item in value["block"].items() if key != "children"}
    return SimpleNamespace(
        block_id=identifier,
        valid_from=value.get("block_revision", version),
        payload=block,
        child_count=value["descriptor"]["child_count"],
    )


def matching_occurrences(text: str, match: str) -> int:
    count, offset = 0, 0
    while (offset := text.find(match, offset)) != -1:
        count += 1
        if count >= 2:
            return count
        offset += 1
    return count


def replace_text(block: dict[str, Any], match: str, replacement: str) -> dict[str, Any]:
    """Replace a unique match inside one inline run without flattening marks."""
    result = deepcopy(block)
    content = result.get("content")
    if not isinstance(content, list):
        raise error(
            422,
            "TEXT_REPLACEMENT_UNSUPPORTED",
            "此组件不支持局部文字替换，请读取结构后使用 update_block",
        )
    runs: list[dict] = []
    for item in content:
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            runs.append(item)
        elif item.get("type") == "link" and isinstance(item.get("content"), list):
            runs.extend(
                child
                for child in item["content"]
                if child.get("type") == "text" and isinstance(child.get("text"), str)
            )
    matches = sum(matching_occurrences(run["text"], match) for run in runs)
    combined = "".join(run["text"] for run in runs)
    if matches != 1 or matching_occurrences(combined, match) != 1:
        raise error(
            409,
            "TEXT_MATCH_CONFLICT",
            "旧文本必须在一个富文本运行段中唯一匹配",
            {"matching_runs": matches},
        )
    for run in runs:
        if match in run["text"]:
            run["text"] = run["text"].replace(match, replacement, 1)
            break
    return result


async def translate_operations(
    store: BlockContentStore, payload: OperationsRequest
) -> tuple[list, list, list, list]:
    upserts: dict[str, dict] = {}
    moves: list[dict] = []
    deletes: list[str] = []
    changed: list[str] = []
    for index, operation in enumerate(payload.operations):
        if isinstance(operation, (UpdateBlock, ReplaceText)):
            if operation.block_id in deletes:
                raise error(422, "OPERATION_TARGET_DELETED", "无法编辑本批次已删除的块")
            row = await block_row(store, operation.block_id, payload.expected_version)
            if (
                operation.expected_block_revision is not None
                and row.valid_from != operation.expected_block_revision
            ):
                raise error(
                    409,
                    "BLOCK_REVISION_CONFLICT",
                    "目标块修订版本已变化",
                    {"block_id": row.block_id, "current_revision": row.valid_from},
                )
            current = upserts.get(row.block_id, row.payload)
            updated = (
                operation.block
                if isinstance(operation, UpdateBlock)
                else replace_text(current, operation.match, operation.replacement)
            )
            if updated.get("id", row.block_id) != row.block_id or "children" in updated:
                raise error(
                    422,
                    "SHALLOW_BLOCK_REQUIRED",
                    "仅可修改目标块本身，不能隐式替换子树或块 ID",
                )
            upserts[row.block_id] = {**updated, "id": row.block_id}
            changed.append(row.block_id)
        elif isinstance(operation, InsertBlocks):
            after = operation.after_id
            for block_index, raw in enumerate(operation.blocks):
                block = deepcopy(raw)
                identifier = (
                    block.get("id")
                    or f"agent-{payload.operation_id}-{index}-{block_index}"
                )
                if "children" in block:
                    raise error(
                        422, "SHALLOW_BLOCK_REQUIRED", "插入浅层块后请显式插入子块"
                    )
                try:
                    await block_row(store, identifier, payload.expected_version)
                    exists = True
                except ApiError as exc:
                    if exc.code != "BLOCK_NOT_FOUND":
                        raise
                    exists = False
                if exists or identifier in upserts:
                    raise error(409, "BLOCK_ID_CONFLICT", "新增块 ID 已存在")
                block["id"] = identifier
                upserts[identifier] = block
                moves.append(
                    {
                        "id": identifier,
                        "parent_id": operation.parent_id,
                        "after_id": after,
                    }
                )
                changed.append(identifier)
                after = identifier
        elif isinstance(operation, MoveBlock):
            if operation.block_id not in upserts:
                await block_row(store, operation.block_id, payload.expected_version)
            moves.append(
                {
                    "id": operation.block_id,
                    "parent_id": operation.parent_id,
                    "after_id": operation.after_id,
                }
            )
            changed.append(operation.block_id)
        elif isinstance(operation, DeleteBlock):
            target = await block_row(
                store, operation.block_id, payload.expected_version
            )
            child = getattr(target, "child_count", None)
            if child is None:
                child = await store.session.scalar(
                    select(Block.id)
                    .where(
                        Block.note_id == store.note.id,
                        Block.parent_id == operation.block_id,
                        at_version(payload.expected_version),
                    )
                    .limit(1)
                )
            if child and not operation.delete_subtree:
                raise error(
                    409,
                    "SUBTREE_DELETE_REQUIRED",
                    "此块有子块，删除需要显式 delete_subtree=true",
                )
            if operation.block_id in upserts:
                raise error(
                    422, "OPERATION_TARGET_CONFLICT", "同一批次不能同时修改并删除一个块"
                )
            deletes.append(operation.block_id)
            changed.append(operation.block_id)
    return list(upserts.values()), moves, deletes, list(dict.fromkeys(changed))


async def claim_note_metadata(
    note_id: UUID, workspace_id: UUID, expected: int, title: str, session: AsyncSession
) -> int:
    timestamp = now_ms()
    updated = await session.scalar(
        update(Note)
        .where(
            Note.id == note_id,
            Note.workspace_id == workspace_id,
            Note.status == "active",
            Note.updated_at_ms == expected,
        )
        .values(
            title=title,
            updated_at_ms=case(
                (Note.updated_at_ms >= timestamp, Note.updated_at_ms + 1),
                else_=timestamp,
            ),
        )
        .returning(Note.updated_at_ms)
        .execution_options(synchronize_session=False)
    )
    if updated is None:
        raise error(409, "NOTE_METADATA_CONFLICT", "文档标题已变化，请重新读取元数据")
    return updated


async def execute_operations(
    principal: IntegrationPrincipal,
    note_id: UUID,
    payload: OperationsRequest,
    session: AsyncSession,
    *,
    preview=False,
) -> dict:
    note = await principal.note(note_id, session, write=True)
    digest = request_digest("edit", note_id, payload)
    if not preview:
        # Serialize receipt checks on PostgreSQL. The unique constraint and CAS
        # still protect SQLite and connections that race before this lock.
        await session.scalar(
            select(IntegrationToken)
            .where(IntegrationToken.id == principal.token.id)
            .with_for_update()
        )
        existing = await receipt(principal, payload.operation_id, session, digest)
        if existing is not None:
            return existing
    store = BlockContentStore(session, note)
    try:
        from orbis_user_api.application.integration_files import (
            validate_document_references,
        )
        from orbis_user_api.application.library_reads import current_content_version

        if not preview:
            await store.activate()
        if await current_content_version(note, session) != payload.expected_version:
            raise NoteVersionConflict
        upserts, moves, deletes, changed = await translate_operations(store, payload)
        await validate_document_references(principal, note_id, upserts, session)
        metadata = [
            operation
            for operation in payload.operations
            if isinstance(operation, UpdateMetadata)
        ]
        if metadata and (
            len({operation.expected_updated_at_ms for operation in metadata}) != 1
            or note.updated_at_ms != metadata[0].expected_updated_at_ms
        ):
            raise error(
                409, "NOTE_METADATA_CONFLICT", "文档标题已变化，请重新读取元数据"
            )
        if preview:
            result = await store.preview_changes(
                payload.expected_version, upserts, moves, deletes
            )
            return {
                **json.loads(json.dumps(result, default=str)),
                "note_id": str(note_id),
                "operation_id": str(payload.operation_id),
                "changed_block_ids": changed,
                "durability": "preview",
                "base_version": payload.expected_version,
                "changes": {"upserts": upserts, "moves": moves, "deletes": deletes},
                "metadata": {"title": metadata[-1].title} if metadata else None,
            }
        result = await store.changes(
            payload.expected_version,
            upserts,
            moves,
            deletes,
            principal.user,
            commit=False,
            touch_note=not bool(metadata),
        )
        if metadata:
            updated = await claim_note_metadata(
                note_id,
                principal.workspace.id,
                metadata[0].expected_updated_at_ms,
                metadata[-1].title,
                session,
            )
            result["metadata_updated_at_ms"] = updated
            result["title"] = metadata[-1].title
        result = {
            **result,
            "note_id": str(note_id),
            "operation_id": str(payload.operation_id),
            "changed_block_ids": changed,
            "durability": "committed",
            "url": f"/documents/{note.id}",
        }
        result = json.loads(json.dumps(result, default=str))
        session.add(
            IntegrationOperation(
                token_id=principal.token.id,
                operation_id=payload.operation_id,
                workspace_id=principal.workspace.id,
                note_id=note_id,
                request_hash=digest,
                result=result,
            )
        )
        await session.commit()
        return result
    except (NoteVersionConflict, IntegrityError):
        await session.rollback()
        await refresh_principal(principal, session)
        if not preview:
            existing = await receipt(principal, payload.operation_id, session, digest)
            if existing is not None:
                return existing
        raise error(
            409, "NOTE_VERSION_CONFLICT", "文档内容已变化，请重新读取后生成新操作"
        ) from None
    except NoteContentInvalid:
        await session.rollback()
        raise error(422, "NOTE_CONTENT_INVALID", "块内容、父级或排序关系无效") from None


async def create_library_note(
    principal: IntegrationPrincipal,
    payload: LibraryCreate,
    session: AsyncSession,
    *,
    prepared_blocks: dict | None = None,
    digest_override: str | None = None,
    commit: bool = True,
) -> dict:
    principal.require("notes:write")
    if principal.token.note_id or (
        principal.token.notebook_id
        and principal.token.notebook_id != payload.notebook_id
    ):
        raise error(403, "INTEGRATION_SCOPE_FORBIDDEN", "不能在集成令牌范围外新建文档")
    digest = digest_override or request_digest("create", None, payload)
    await session.scalar(
        select(IntegrationToken)
        .where(IntegrationToken.id == principal.token.id)
        .with_for_update()
    )
    existing = await receipt(principal, payload.operation_id, session, digest)
    if existing is not None:
        return existing
    try:
        await _get_active_notebook(payload.notebook_id, principal.workspace.id, session)
        await _validate_parent(
            payload.parent_id, payload.notebook_id, principal.workspace.id, session
        )
        blocks = (
            prepared_blocks
            if prepared_blocks is not None
            else markdown_to_blocks(payload.markdown)
        )
        from orbis_user_api.application.integration_files import (
            validate_new_note_references,
        )

        file_ids = await validate_new_note_references(principal, blocks, session)
        note = Note(
            id=new_uuidv7(),
            tenant_id=principal.workspace.tenant_id,
            workspace_id=principal.workspace.id,
            owner_id=principal.user.id,
            notebook_id=payload.notebook_id,
            parent_id=payload.parent_id,
            title=payload.title,
        )
        session.add(note)
        from orbis_user_api.models.integration import IntegrationAttachment

        session.add_all(
            IntegrationAttachment(
                file_id=file_id, note_id=note.id, workspace_id=principal.workspace.id
            )
            for file_id in file_ids
        )
        session.add(
            NoteContent(
                note_id=note.id,
                blocks=blocks,
                plain_text=derive_plain_text(blocks),
                content_version=1,
            )
        )
        await session.flush()
        await BlockContentStore(session, note).activate()
        result = {
            "note_id": str(note.id),
            "operation_id": str(payload.operation_id),
            "content_version": 1,
            "durability": "committed",
            "url": f"/documents/{note.id}",
        }
        session.add(
            IntegrationOperation(
                token_id=principal.token.id,
                operation_id=payload.operation_id,
                workspace_id=principal.workspace.id,
                note_id=note.id,
                request_hash=digest,
                result=result,
            )
        )
        await session.flush()
        if commit:
            await session.commit()
        return result
    except IntegrityError:
        await session.rollback()
        await refresh_principal(principal, session)
        existing = await receipt(principal, payload.operation_id, session, digest)
        if existing is not None:
            return existing
        raise error(409, "CREATE_CONFLICT", "新建文档冲突，请查询原操作结果") from None
    except (NotebookNotFound, NoteParentInvalid):
        await session.rollback()
        raise error(404, "INTEGRATION_SCOPE_NOT_FOUND", "文集或父文档不存在") from None
    except (InvalidNoteContent, NoteContentInvalid):
        await session.rollback()
        raise error(422, "NOTE_CONTENT_INVALID", "Markdown 内容无效") from None
