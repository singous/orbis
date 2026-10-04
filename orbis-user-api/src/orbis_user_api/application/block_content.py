from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from orbis_user_api.application.block_changes import (
    BlockChangePlan,
    LegacyBlockChangePlanner,
    SparseBlockChangePlanner,
)
from orbis_user_api.application.block_pages import (
    MIN_PAGE_BYTES,
    bounded_page,
    json_bytes,
)
from orbis_user_api.application.legacy_block_pages import (
    read_legacy_block,
    read_legacy_page,
)
from orbis_user_api.core.time import now_ms
from orbis_user_api.domain.block_records import (
    assemble_blocks,
    flatten_blocks,
    storage_blocks,
)
from orbis_user_api.domain.legacy_note_blocks import editable_note_blocks
from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    derive_plain_text,
    normalize_note_blocks,
)
from orbis_user_api.models.collaboration import NoteRevision
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.note_block import NoteBlockDocument, NoteBlockSnapshot
from orbis_user_api.models.note_block import NoteBlockVersion as Block
from orbis_user_api.models.user import User
from orbis_user_api.services.exceptions import (
    NoteContentInvalid,
    NoteNotFound,
    NoteVersionConflict,
)


def at_version(version: int):
    return and_(
        Block.valid_from <= version,
        or_(Block.valid_to.is_(None), Block.valid_to > version),
    )


class BlockContentStore:
    """Versioned block reads and writes behind one content-storage interface.

    Callers authorize the Note before entering this module. Legacy JSON is an
    immutable migration backup, never the live write target after activation.
    """

    def __init__(self, session: AsyncSession, note: Note):
        self.session, self.note = session, note

    async def header(self) -> NoteBlockDocument | None:
        return await self.session.scalar(
            select(NoteBlockDocument)
            .where(NoteBlockDocument.note_id == self.note.id)
            .execution_options(populate_existing=True)
        )

    async def activate(self) -> NoteBlockDocument:
        existing = await self.header()
        if existing is not None:
            return existing
        # Serialize first activation with existing legacy writers. Recheck after
        # obtaining the row lock; another activation may have committed first.
        await self.session.execute(
            update(NoteContent)
            .where(NoteContent.note_id == self.note.id)
            .values(content_version=NoteContent.content_version)
        )
        existing = await self.header()
        if existing is not None:
            return existing
        legacy = await self.session.scalar(
            select(NoteContent).where(NoteContent.note_id == self.note.id)
        )
        if legacy is None:
            raise NoteNotFound
        try:
            projected, repaired = storage_blocks(
                self.note.id, editable_note_blocks(self.note.id, legacy.blocks)
            )
            records = flatten_blocks(projected)
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        header = NoteBlockDocument(
            note_id=self.note.id,
            workspace_id=self.note.workspace_id,
            content_version=legacy.content_version,
            root_count=sum(row["parent_id"] is None for row in records),
            created_at_ms=legacy.created_at_ms,
            updated_at_ms=legacy.updated_at_ms,
        )
        self.session.add(header)
        self.session.add_all(
            Block(note_id=self.note.id, valid_from=legacy.content_version, **row)
            for row in records
        )
        self.session.add(
            NoteBlockSnapshot(
                note_id=self.note.id,
                content_version=legacy.content_version,
                source_schema=3 if repaired else legacy.blocks["schema_version"],
                root_count=header.root_count,
                created_at_ms=legacy.updated_at_ms,
            )
        )
        await self.session.flush()
        candidate = assemble_blocks(await self._records(legacy.content_version))
        if candidate != projected:
            raise NoteContentInvalid
        return header

    async def snapshot(
        self, version: int | None = None
    ) -> tuple[NoteBlockDocument, NoteBlockSnapshot]:
        header = await self.header()
        if header is None:
            raise NoteNotFound
        version = header.content_version if version is None else version
        snapshot = await self.session.scalar(
            select(NoteBlockSnapshot).where(
                NoteBlockSnapshot.note_id == self.note.id,
                NoteBlockSnapshot.content_version == version,
            )
        )
        if snapshot is None:
            # Old revision JSON remains a read-only compatibility source. A GET
            # must not create rows, switch authority or commit its caller's work.
            revision = await self.session.scalar(
                select(NoteRevision).where(
                    NoteRevision.note_id == self.note.id,
                    NoteRevision.workspace_id == self.note.workspace_id,
                    NoteRevision.content_version == version,
                )
            )
            if revision is None or not revision.blocks:
                raise NoteVersionConflict
            try:
                projected, repaired = storage_blocks(
                    self.note.id, editable_note_blocks(self.note.id, revision.blocks)
                )
            except InvalidNoteContent:
                raise NoteContentInvalid from None
            snapshot = NoteBlockSnapshot(
                note_id=self.note.id,
                content_version=version,
                source_schema=3 if repaired else revision.blocks["schema_version"],
                root_count=len(projected["blocks"]),
                created_at_ms=revision.created_at_ms,
            )
        return header, snapshot

    async def current_version(self) -> int:
        header = await self.header()
        if header is not None:
            return header.content_version
        version = await self.session.scalar(
            select(NoteContent.content_version).where(
                NoteContent.note_id == self.note.id
            )
        )
        if version is None:
            raise NoteNotFound
        return version

    async def _legacy_content(self, version: int | None = None) -> NoteContent:
        filters = [NoteContent.note_id == self.note.id]
        if version is not None:
            filters.append(NoteContent.content_version == version)
        row = await self.session.scalar(select(NoteContent).where(*filters))
        if row is None and version is not None:
            row = await self.session.scalar(
                select(NoteRevision).where(
                    NoteRevision.note_id == self.note.id,
                    NoteRevision.workspace_id == self.note.workspace_id,
                    NoteRevision.content_version == version,
                )
            )
        if row is None or not row.blocks:
            raise NoteVersionConflict if version is not None else NoteNotFound
        return NoteContent(
            note_id=self.note.id,
            blocks=row.blocks,
            plain_text=derive_plain_text(row.blocks),
            content_version=row.content_version,
            created_at_ms=row.created_at_ms,
            updated_at_ms=row.updated_at_ms
            if isinstance(row, NoteContent)
            else row.created_at_ms,
        )

    async def preview_changes(
        self,
        expected_version: int,
        upserts: list[dict[str, Any]],
        moves: list[dict[str, Any]],
        deletes: list[str],
    ) -> dict[str, Any]:
        """Validate a mutation without activating storage or staging any writes."""
        with self.session.no_autoflush:
            header = await self.header()
            if header is None:
                legacy = await self._legacy_content()
                if legacy.content_version != expected_version:
                    raise NoteVersionConflict
                try:
                    projected, _repaired = storage_blocks(
                        self.note.id, editable_note_blocks(self.note.id, legacy.blocks)
                    )
                    records = flatten_blocks(projected)
                except InvalidNoteContent:
                    raise NoteContentInvalid from None
                plan = await LegacyBlockChangePlanner(records).plan(
                    upserts, moves, deletes
                )
                total = len(projected["blocks"]) + plan.root_delta
            else:
                await self._lock_current_read(expected_version)
                header = await self.header()
                if header.content_version != expected_version:
                    raise NoteVersionConflict
                plan = await SparseBlockChangePlanner(self.session, self.note.id).plan(
                    upserts, moves, deletes
                )
                total = header.root_count + plan.root_delta
            if await self.current_version() != expected_version:
                raise NoteVersionConflict
        return {
            "note_id": self.note.id,
            "content_version": expected_version + 1,
            "total_blocks": total,
            "updated_at_ms": now_ms(),
        }

    async def _records(
        self, version: int, roots: list[str] | None = None
    ) -> list[Block]:
        statement = select(Block).where(
            Block.note_id == self.note.id, at_version(version)
        )
        if roots is not None:
            if not roots:
                return []
            tree = (
                select(Block.block_id)
                .where(
                    Block.note_id == self.note.id,
                    Block.parent_id.is_(None),
                    Block.block_id.in_(roots),
                    at_version(version),
                )
                .cte("content_subtree", recursive=True)
            )
            tree = tree.union_all(
                select(Block.block_id)
                .join(tree, Block.parent_id == tree.c.block_id)
                .where(Block.note_id == self.note.id, at_version(version))
            )
            statement = statement.where(Block.block_id.in_(select(tree.c.block_id)))
        return list(await self.session.scalars(statement))

    async def page(
        self, offset: int, limit: int, version: int | None = None
    ) -> dict[str, Any]:
        header, snapshot = await self.snapshot(version)
        version = snapshot.content_version
        if snapshot.id is None:
            legacy = await self._legacy_content(version)
            projected, _repaired = storage_blocks(
                self.note.id, editable_note_blocks(self.note.id, legacy.blocks)
            )
            roots = projected["blocks"][offset : offset + limit]
            return {
                "note_id": self.note.id,
                "storage_format": "legacy",
                "blocks": {**projected, "blocks": roots},
                "content_version": version,
                "created_at_ms": header.created_at_ms,
                "updated_at_ms": snapshot.created_at_ms,
                "offset": offset,
                "next_offset": offset + len(roots),
                "total_blocks": snapshot.root_count,
                "has_more": offset + len(roots) < snapshot.root_count,
            }
        columns = (
            Block.block_id,
            Block.parent_id,
            Block.position,
            Block.payload,
            Block.has_children_field,
        )
        selected = (
            select(*columns)
            .where(
                Block.note_id == self.note.id,
                Block.parent_id.is_(None),
                at_version(version),
            )
            .order_by(Block.position, Block.block_id)
            .offset(offset)
            .limit(limit)
        )
        records = list((await self.session.execute(selected)).all())
        roots = [row.block_id for row in records]
        parents = roots
        while parents:
            children = list(
                (
                    await self.session.execute(
                        select(*columns).where(
                            Block.note_id == self.note.id,
                            Block.parent_id.in_(parents),
                            at_version(version),
                        )
                    )
                ).all()
            )
            records.extend(children)
            parents = [row.block_id for row in children]
        blocks = assemble_blocks(records, roots, preserve_shape=False)
        return {
            "note_id": self.note.id,
            "storage_format": "blocks",
            "blocks": blocks,
            "content_version": version,
            "created_at_ms": header.created_at_ms,
            "updated_at_ms": snapshot.created_at_ms,
            "offset": offset,
            "next_offset": offset + len(roots),
            "total_blocks": snapshot.root_count,
            "has_more": offset + len(roots) < snapshot.root_count,
        }

    async def _lock_current_read(self, version: int | None) -> None:
        header = await self.header()
        if header is not None and (
            version is None or version == header.content_version
        ):
            # A short shared lock makes a current-row partial-index read an
            # immutable snapshot until the read request's session closes. CAS
            # writers serialize on this same header, never on all content rows.
            await self.session.scalar(
                select(NoteBlockDocument)
                .where(NoteBlockDocument.note_id == self.note.id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )

    async def children(
        self,
        parent_id: str | None = None,
        offset: int = 0,
        limit: int = 32,
        version: int | None = None,
        max_bytes: int = 128 * 1024,
    ) -> dict[str, Any]:
        """Read direct siblings without expanding descendants or oversized bodies."""
        if offset < 0 or not 1 <= limit <= 256 or max_bytes < MIN_PAGE_BYTES:
            raise NoteContentInvalid
        if await self.header() is None:
            return await read_legacy_page(
                self.note, self.session, parent_id, offset, limit, version, max_bytes
            )
        await self._lock_current_read(version)
        header, snapshot = await self.snapshot(version)
        version = snapshot.content_version
        if snapshot.id is None:
            return await read_legacy_page(
                self.note, self.session, parent_id, offset, limit, version, max_bytes
            )
        validity = (
            Block.valid_to.is_(None)
            if version == header.content_version
            else at_version(version)
        )
        scope = [Block.note_id == self.note.id, validity]
        if parent_id is not None:
            parent = await self.session.scalar(
                select(Block.id).where(*scope, Block.block_id == parent_id)
            )
            if parent is None:
                raise NoteContentInvalid
        sibling_scope = [
            *scope,
            Block.parent_id == parent_id
            if parent_id is not None
            else Block.parent_id.is_(None),
        ]
        total = (
            snapshot.root_count
            if parent_id is None
            else int(
                await self.session.scalar(
                    select(func.count()).select_from(Block).where(*sibling_scope)
                )
                or 0
            )
        )
        rows = (
            await self.session.execute(
                select(Block.block_id, Block.block_type, Block.payload_bytes)
                .where(*sibling_scope)
                .order_by(Block.position, Block.block_id)
                .offset(offset)
                .limit(limit)
            )
        ).all()
        identifiers = [row.block_id for row in rows]
        counts = (
            dict(
                (
                    await self.session.execute(
                        select(Block.parent_id, func.count())
                        .where(*scope, Block.parent_id.in_(identifiers))
                        .group_by(Block.parent_id)
                    )
                ).all()
            )
            if identifiers
            else {}
        )
        metadata = [
            {
                "id": row.block_id,
                "block_type": row.block_type,
                "payload_bytes": row.payload_bytes,
                "child_count": counts.get(row.block_id, 0),
            }
            for row in rows
        ]

        async def load(row):
            return await self.session.scalar(
                select(Block.payload).where(*scope, Block.block_id == row["id"])
            )

        async def load_many(rows):
            if not rows:
                return {}
            return dict(
                (
                    await self.session.execute(
                        select(Block.block_id, Block.payload).where(
                            *scope, Block.block_id.in_([row["id"] for row in rows])
                        )
                    )
                ).all()
            )

        base = {
            "note_id": self.note.id,
            "storage_format": "blocks",
            "parent_id": parent_id,
            "content_version": version,
            "created_at_ms": header.created_at_ms,
            "updated_at_ms": snapshot.created_at_ms,
            "offset": offset,
            "next_offset": offset,
            "total_blocks": total,
            "has_more": offset < total,
        }
        return await bounded_page(
            base, metadata, load, max_bytes, load_payloads=load_many
        )

    async def block(
        self,
        identifier: str,
        version: int | None = None,
        *,
        read_lock: bool = False,
    ) -> dict[str, Any]:
        if await self.header() is None:
            return await read_legacy_block(self.note, self.session, identifier, version)
        if read_lock:
            await self._lock_current_read(version)
        header, snapshot = await self.snapshot(version)
        if snapshot.id is None:
            return await read_legacy_block(self.note, self.session, identifier, version)
        validity = (
            Block.valid_to.is_(None)
            if read_lock and snapshot.content_version == header.content_version
            else at_version(snapshot.content_version)
        )
        scope = [Block.note_id == self.note.id, validity]
        row = await self.session.scalar(
            select(Block).where(*scope, Block.block_id == identifier)
        )
        if row is None:
            raise NoteNotFound
        count = int(
            await self.session.scalar(
                select(func.count())
                .select_from(Block)
                .where(*scope, Block.parent_id == identifier)
            )
            or 0
        )
        return {
            "note_id": self.note.id,
            "content_version": snapshot.content_version,
            "block": {**deepcopy(row.payload), "children": []},
            "block_revision": row.valid_from,
            "descriptor": {
                "id": identifier,
                "parent_id": row.parent_id,
                "child_count": count,
                "has_children": count > 0,
                "children_loaded": count == 0,
                "payload_loaded": True,
                "payload_bytes": row.payload_bytes or json_bytes(row.payload),
            },
        }

    async def changed_blocks(
        self,
        since_version: int,
        limit: int = 32,
        offset: int = 0,
        target_version: int | None = None,
    ) -> dict[str, Any]:
        """List changed identities against a fixed target snapshot, without bodies."""
        header = await self.header()
        target = (
            await self.current_version() if target_version is None else target_version
        )
        if (
            since_version < 1
            or since_version > target
            or offset < 0
            or not 1 <= limit <= 256
        ):
            raise NoteVersionConflict
        if header is None:
            return await self._legacy_changed_blocks(
                since_version, target, limit, offset
            )
        _header, snapshot = await self.snapshot(target)
        _base_header, base_snapshot = await self.snapshot(since_version)
        if snapshot.id is None or base_snapshot.id is None:
            return await self._legacy_changed_blocks(
                since_version, target, limit, offset
            )
        if (
            since_version < 1
            or since_version > target
            or offset < 0
            or not 1 <= limit <= 256
        ):
            raise NoteVersionConflict
        await self.snapshot(since_version)
        closed = and_(Block.valid_to > since_version, Block.valid_to <= target)
        opened = and_(Block.valid_from > since_version, Block.valid_from <= target)
        change_version = case((closed, Block.valid_to), else_=Block.valid_from)
        changed = (
            select(Block.block_id, func.max(change_version).label("block_revision"))
            .where(Block.note_id == self.note.id, or_(opened, closed))
            .group_by(Block.block_id)
            .subquery()
        )
        rows = (
            await self.session.execute(
                select(changed)
                .order_by(changed.c.block_revision, changed.c.block_id)
                .offset(offset)
                .limit(limit + 1)
            )
        ).all()
        selected = rows[:limit]
        validity = at_version(target)
        present = (
            set(
                await self.session.scalars(
                    select(Block.block_id).where(
                        Block.note_id == self.note.id,
                        validity,
                        Block.block_id.in_([row.block_id for row in selected]),
                    )
                )
            )
            if selected
            else set()
        )
        return {
            "since_version": since_version,
            "content_version": target,
            "items": [
                {
                    "id": row.block_id,
                    "change": "upsert" if row.block_id in present else "deleted",
                    "block_revision": row.block_revision,
                }
                for row in selected
            ],
            "next_offset": offset + len(selected),
            "has_more": len(rows) > limit,
        }

    async def _legacy_changed_blocks(
        self, since: int, target: int, limit: int, offset: int
    ) -> dict[str, Any]:
        # Only old JSON snapshots need a whole-history projection. Current
        # native feeds stay on indexed block versions and never read a body.
        if since == target:
            return {
                "since_version": since,
                "content_version": target,
                "items": [],
                "next_offset": offset,
                "has_more": False,
            }

        async def projection(version):
            content = await self.full(version)
            try:
                projected, _repaired = storage_blocks(
                    self.note.id, editable_note_blocks(self.note.id, content.blocks)
                )
                return {
                    row["block_id"]: (row["parent_id"], row["position"], row["payload"])
                    for row in flatten_blocks(projected)
                }
            except InvalidNoteContent:
                raise NoteContentInvalid from None

        before, after = await projection(since), await projection(target)
        identifiers = sorted(
            key for key in set(before) | set(after) if before.get(key) != after.get(key)
        )
        selected = identifiers[offset : offset + limit]
        return {
            "since_version": since,
            "content_version": target,
            "items": [
                {
                    "id": key,
                    "change": "upsert" if key in after else "deleted",
                    "block_revision": target,
                }
                for key in selected
            ],
            "next_offset": offset + len(selected),
            "has_more": offset + len(selected) < len(identifiers),
        }

    async def full(self, version: int | None = None) -> NoteContent:
        if await self.header() is None:
            return await self._legacy_content(version)
        header, snapshot = await self.snapshot(version)
        if snapshot.id is None:
            legacy = await self._legacy_content(snapshot.content_version)
            legacy.created_at_ms = header.created_at_ms
            legacy.updated_at_ms = snapshot.created_at_ms
            return legacy
        blocks = None
        if snapshot.source_schema in (1, 3):
            legacy = await self.session.scalar(
                select(NoteContent.blocks).where(
                    NoteContent.note_id == self.note.id,
                    NoteContent.content_version == snapshot.content_version,
                )
            )
            if legacy is None:
                legacy = await self.session.scalar(
                    select(NoteRevision.blocks).where(
                        NoteRevision.note_id == self.note.id,
                        NoteRevision.content_version == snapshot.content_version,
                    )
                )
            if legacy:
                blocks = legacy
        if blocks is None:
            blocks = assemble_blocks(await self._records(snapshot.content_version))
        return NoteContent(
            note_id=self.note.id,
            blocks=blocks,
            plain_text=derive_plain_text(blocks),
            content_version=snapshot.content_version,
            created_at_ms=header.created_at_ms,
            updated_at_ms=snapshot.created_at_ms,
        )

    async def outline(self, version: int) -> dict[str, Any]:
        header = await self.header()
        snapshot = None
        if header is not None:
            _header, snapshot = await self.snapshot(version)
        if header is None or snapshot.id is None:
            content = await self.full(version)
            try:
                projected, _repaired = storage_blocks(
                    self.note.id, editable_note_blocks(self.note.id, content.blocks)
                )
            except InvalidNoteContent:
                raise NoteContentInvalid from None
            return {
                "content_version": version,
                "items": [
                    {
                        "id": item["id"],
                        "level": item.get("props", {}).get("level", 1),
                        "text": derive_plain_text(
                            {"schema_version": 2, "blocks": [item]}
                        )[:256]
                        or "未命名标题",
                        "root_index": index,
                    }
                    for index, item in enumerate(projected["blocks"])
                    if item["type"] == "heading"
                ],
            }
        roots = (
            select(
                Block.block_id,
                Block.block_type,
                (
                    func.row_number().over(order_by=(Block.position, Block.block_id))
                    - 1
                ).label("root_index"),
            )
            .where(
                Block.note_id == self.note.id,
                Block.parent_id.is_(None),
                at_version(version),
            )
            .subquery()
        )
        rows = (
            await self.session.execute(
                select(
                    Block.block_id, Block.payload, Block.plain_text, roots.c.root_index
                )
                .join(roots, roots.c.block_id == Block.block_id)
                .where(
                    Block.note_id == self.note.id,
                    at_version(version),
                    roots.c.block_type == "heading",
                )
                .order_by(roots.c.root_index)
            )
        ).all()
        return {
            "content_version": version,
            "items": [
                {
                    "id": row.block_id,
                    "level": row.payload.get("props", {}).get("level", 1),
                    "text": row.plain_text[:256] or "未命名标题",
                    "root_index": row.root_index,
                }
                for row in rows
            ],
        }

    async def _manifest(
        self, identifiers: list[str] | None = None
    ) -> dict[str, dict[str, Any]]:
        statement = select(
            Block.id, Block.block_id, Block.parent_id, Block.position, Block.block_type
        ).where(Block.note_id == self.note.id, Block.valid_to.is_(None))
        if identifiers is not None:
            statement = statement.where(Block.block_id.in_(identifiers))
        rows = (await self.session.execute(statement)).all()
        return {
            row.block_id: {
                "row_id": row.id,
                "block_type": row.block_type,
                "parent_id": row.parent_id,
                "position": row.position,
                "placed": True,
            }
            for row in rows
        }

    async def changes(
        self,
        expected_version: int,
        upserts: list[dict[str, Any]],
        moves: list[dict[str, Any]],
        deletes: list[str],
        user: User,
        *,
        source: dict[str, Any] | None = None,
        commit: bool = True,
        touch_note: bool = True,
        planned: BlockChangePlan | None = None,
    ) -> dict[str, Any]:
        """Stage an atomic mutation, optionally sharing the caller's transaction.

        With commit=False the caller must commit or roll back the entire session,
        including its operation receipt. No partial content is independently
        committed. expected_version retains strict document-level CAS semantics.
        """
        header = await self.activate()
        if header.content_version != expected_version:
            raise NoteVersionConflict
        version, timestamp = expected_version + 1, now_ms()
        claimed = await self.session.execute(
            update(NoteBlockDocument)
            .where(
                NoteBlockDocument.id == header.id,
                NoteBlockDocument.content_version == expected_version,
            )
            .values(content_version=version, updated_at_ms=timestamp)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            raise NoteVersionConflict
        plan = planned or await SparseBlockChangePlanner(
            self.session, self.note.id
        ).plan(upserts, moves, deletes)
        total = header.root_count + plan.root_delta
        await self.session.execute(
            update(NoteBlockDocument)
            .where(NoteBlockDocument.id == header.id)
            .values(root_count=total)
            .execution_options(synchronize_session=False)
        )
        candidates = plan.candidates
        rows = (
            list(
                await self.session.scalars(
                    select(Block).where(
                        Block.note_id == self.note.id,
                        Block.block_id.in_(candidates),
                        Block.valid_to.is_(None),
                    )
                )
            )
            if candidates
            else []
        )
        old = {row.block_id: row for row in rows}
        shapes = (
            {
                row["block_id"]: row["has_children_field"]
                for row in flatten_blocks(
                    storage_blocks(
                        self.note.id, editable_note_blocks(self.note.id, source)
                    )[0]
                )
            }
            if source
            else {}
        )
        changed = {
            key
            for key in candidates
            if key not in old
            or old[key].payload != plan.payloads.get(key, old[key].payload)
            or old[key].has_children_field
            != shapes.get(key, old[key].has_children_field)
            or (old[key].parent_id, old[key].position)
            != (plan.current[key]["parent_id"], plan.current[key]["position"])
        }
        close_ids = [
            plan.before[key]["row_id"]
            for key in changed | plan.removed
            if key in plan.before
        ]
        for start in range(0, len(close_ids), 500):
            await self.session.execute(
                update(Block)
                .where(
                    Block.id.in_(close_ids[start : start + 500]),
                    Block.valid_to.is_(None),
                )
                .values(valid_to=version)
                .execution_options(synchronize_session=False)
            )
        for key in changed:
            payload = plan.payloads.get(key, old[key].payload if key in old else None)
            self.session.add(
                Block(
                    note_id=self.note.id,
                    block_id=key,
                    parent_id=plan.current[key]["parent_id"],
                    position=plan.current[key]["position"],
                    has_children_field=shapes.get(
                        key, old[key].has_children_field if key in old else True
                    ),
                    block_type=payload["type"],
                    payload=payload,
                    payload_bytes=len(
                        json.dumps(
                            payload, ensure_ascii=False, separators=(",", ":")
                        ).encode("utf-8")
                    ),
                    plain_text=derive_plain_text(
                        {"schema_version": 2, "blocks": [{**payload, "children": []}]}
                    ),
                    valid_from=version,
                )
            )
        await self._record_revisions(
            header, expected_version, version, timestamp, user, source
        )
        repaired = (
            storage_blocks(self.note.id, editable_note_blocks(self.note.id, source))[1]
            if source
            else False
        )
        self.session.add(
            NoteBlockSnapshot(
                note_id=self.note.id,
                content_version=version,
                source_schema=(3 if repaired else source["schema_version"])
                if source
                else 2,
                root_count=total,
                created_at_ms=timestamp,
            )
        )
        note_timestamp = timestamp
        if touch_note:
            # Preserve header -> Note lock order, and advance metadata stamps
            # even when two writers share a millisecond or the wall clock drifts.
            note_timestamp = await self.session.scalar(
                update(Note)
                .where(Note.id == self.note.id)
                .values(
                    updated_at_ms=case(
                        (Note.updated_at_ms >= timestamp, Note.updated_at_ms + 1),
                        else_=timestamp,
                    )
                )
                .returning(Note.updated_at_ms)
                .execution_options(synchronize_session=False)
            )
            if note_timestamp is None:
                raise NoteNotFound
            set_committed_value(self.note, "updated_at_ms", note_timestamp)
        try:
            await self.session.flush()
            if commit:
                await self.session.commit()
        except IntegrityError:
            if commit:
                await self.session.rollback()
            raise NoteVersionConflict from None
        return {
            "note_id": self.note.id,
            "content_version": version,
            "total_blocks": total,
            "updated_at_ms": note_timestamp,
        }

    async def _record_revisions(
        self, header, expected_version, version, timestamp, user, source
    ):
        existing_revision = await self.session.scalar(
            select(NoteRevision.id).where(
                NoteRevision.note_id == self.note.id,
                NoteRevision.content_version == expected_version,
            )
        )
        if existing_revision is None:
            owner = (
                await self.session.get(User, self.note.owner_id)
                if expected_version == 1
                else None
            )
            self.session.add(
                NoteRevision(
                    note_id=self.note.id,
                    workspace_id=self.note.workspace_id,
                    content_version=expected_version,
                    author_id=owner.id if owner else None,
                    author_name=(owner.display_name or "未命名成员")
                    if owner
                    else "历史版本",
                    blocks={},
                    plain_text="",
                    created_at_ms=header.updated_at_ms,
                )
            )
        self.session.add(
            NoteRevision(
                note_id=self.note.id,
                workspace_id=self.note.workspace_id,
                content_version=version,
                author_id=user.id,
                author_name=user.display_name or "未命名成员",
                blocks=source
                if source
                and (
                    source["schema_version"] == 1
                    or storage_blocks(
                        self.note.id, editable_note_blocks(self.note.id, source)
                    )[1]
                )
                else {},
                plain_text=derive_plain_text(source)
                if source
                and (
                    source["schema_version"] == 1
                    or storage_blocks(
                        self.note.id, editable_note_blocks(self.note.id, source)
                    )[1]
                )
                else "",
                created_at_ms=timestamp,
            )
        )

    async def replace(
        self, expected_version: int, blocks: dict[str, Any], user: User
    ) -> NoteContent:
        try:
            source = normalize_note_blocks(blocks)
            projected, _repaired = storage_blocks(
                self.note.id, editable_note_blocks(self.note.id, source)
            )
            records = flatten_blocks(projected)
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        await self.activate()
        manifest = await self._manifest()
        # Whole replacement already supplied and validated a complete tree. It
        # can build a linear plan directly rather than issue a neighbor query
        # for every block during a large import.
        current = {
            row["block_id"]: {
                "row_id": manifest.get(row["block_id"], {}).get("row_id"),
                "parent_id": row["parent_id"],
                "position": row["position"],
                "block_type": row["block_type"],
                "placed": True,
            }
            for row in records
        }
        plan = BlockChangePlan(
            manifest,
            current,
            {row["block_id"]: row["payload"] for row in records},
            set(manifest) - set(current),
        )
        await self.changes(
            expected_version, [], [], [], user, source=source, planned=plan
        )
        return await self.full(expected_version + 1)


async def read_stored_content(
    note: Note, session: AsyncSession, version: int | None = None
) -> NoteContent:
    store = BlockContentStore(session, note)
    if await store.header() is not None:
        return await store.full(version)
    if version is not None:
        revision = await session.scalar(
            select(NoteRevision).where(
                NoteRevision.note_id == note.id,
                NoteRevision.content_version == version,
                NoteRevision.workspace_id == note.workspace_id,
            )
        )
        if revision is None:
            raise NoteVersionConflict
        return NoteContent(
            note_id=note.id,
            blocks=revision.blocks,
            plain_text=revision.plain_text,
            content_version=version,
            created_at_ms=revision.created_at_ms,
            updated_at_ms=revision.created_at_ms,
        )
    content = await session.scalar(
        select(NoteContent).where(NoteContent.note_id == note.id)
    )
    if content is None:
        raise NoteNotFound
    return content
