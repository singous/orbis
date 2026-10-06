"""Plan sparse block changes without materializing a document-wide manifest."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.domain.block_records import POSITION_STEP
from orbis_user_api.domain.document_components import DOCUMENT_BLOCKS
from orbis_user_api.domain.note_content import InvalidNoteContent, normalize_note_blocks
from orbis_user_api.models.note_block import NoteBlockVersion as Block
from orbis_user_api.services.exceptions import NoteContentInvalid

METADATA_COLUMNS = (
    Block.id,
    Block.block_id,
    Block.parent_id,
    Block.position,
    Block.block_type,
)
MAX_POSITION = (1 << 63) - 1
REBALANCE_WINDOW_SIZE = 128


def metadata(row) -> dict[str, Any]:
    return {
        "row_id": row.id,
        "parent_id": row.parent_id,
        "position": row.position,
        "block_type": row.block_type,
        "placed": True,
    }


@dataclass
class BlockChangePlan:
    before: dict[str, dict[str, Any]]
    current: dict[str, dict[str, Any]]
    payloads: dict[str, dict[str, Any]]
    removed: set[str]

    @property
    def candidates(self) -> set[str]:
        return set(self.payloads) | {
            key
            for key, value in self.current.items()
            if key in self.before
            and (value["parent_id"], value["position"])
            != (self.before[key]["parent_id"], self.before[key]["position"])
        }

    @property
    def root_delta(self) -> int:
        delta = 0
        for key in self.candidates:
            delta += int(self.current[key]["parent_id"] is None)
            delta -= int(key in self.before and self.before[key]["parent_id"] is None)
        return delta - sum(
            self.before[key]["parent_id"] is None
            for key in self.removed
            if key in self.before
        )


class SparseBlockChangePlanner:
    """Load identities, neighbors and ancestors only as an operation needs them.

    A document-level CAS must be held by the caller before planning. The overlay
    preserves ordered operations while database rows remain immutable until the
    complete plan has passed validation.
    """

    def __init__(self, session: AsyncSession, note_id: UUID):
        self.session, self.note_id = session, note_id
        self.before: dict[str, dict[str, Any]] = {}
        self.current: dict[str, dict[str, Any]] = {}
        self.relocated: set[str] = set()

    def query(self):
        return select(*METADATA_COLUMNS).where(
            Block.note_id == self.note_id, Block.valid_to.is_(None)
        )

    def remember(self, rows) -> None:
        for row in rows:
            if row.block_id not in self.before:
                self.before[row.block_id] = metadata(row)
                self.current.setdefault(
                    row.block_id, deepcopy(self.before[row.block_id])
                )

    async def load(self, identifiers) -> None:
        pending = set(identifiers) - set(self.before)
        pending.discard(None)
        # Bound parameter counts for legacy full replacements too.
        ordered = list(pending)
        for start in range(0, len(ordered), 500):
            self.remember(
                (
                    await self.session.execute(
                        self.query().where(
                            Block.block_id.in_(ordered[start : start + 500])
                        )
                    )
                ).all()
            )

    async def neighbor(self, parent, after, excluding: str):
        filters = [
            Block.parent_id == parent
            if parent is not None
            else Block.parent_id.is_(None)
        ]
        hidden = self.relocated | {excluding}
        if hidden:
            filters.append(Block.block_id.not_in(hidden))
        if after is not None:
            value = self.current[after]
            filters.append(
                or_(
                    Block.position > value["position"],
                    and_(Block.position == value["position"], Block.block_id > after),
                )
            )
        row = (
            await self.session.execute(
                self.query()
                .where(*filters)
                .order_by(Block.position, Block.block_id)
                .limit(1)
            )
        ).first()
        if row is not None:
            self.remember([row])
        options = [(row.position, row.block_id)] if row is not None else []
        for key in self.relocated - {excluding}:
            value = self.current[key]
            if not value["placed"] or value["parent_id"] != parent:
                continue
            item = (value["position"], key)
            if after is None or item > (self.current[after]["position"], after):
                options.append(item)
        return min(options) if options else None

    async def rebalance(self, parent, excluding: str, after: str | None):
        """Redistribute a nearby window when midpoint gaps are exhausted.

        Ordinary repeated inserts near the beginning never renumber a 30k-block
        document. Expand the local window only if its right boundary is densely
        packed too; metadata and rewritten rows stay proportional to that window.
        """
        left = self.current[after]["position"] if after is not None else 0
        window_size = REBALANCE_WINDOW_SIZE
        while True:
            query = (
                self.query()
                .where(
                    Block.parent_id == parent
                    if parent is not None
                    else Block.parent_id.is_(None),
                    Block.position > left,
                    Block.block_id.not_in(self.relocated | {excluding}),
                )
                .order_by(Block.position, Block.block_id)
                .limit(window_size + 1)
            )
            rows = (await self.session.execute(query)).all()
            self.remember(rows)
            options = {(row.position, row.block_id) for row in rows}
            options |= {
                (value["position"], key)
                for key, value in self.current.items()
                if key in self.relocated
                and key != excluding
                and value["placed"]
                and value["parent_id"] == parent
                and value["position"] > left
            }
            ordered = sorted(options)[: window_size + 1]
            selected = ordered[:window_size]
            boundary = (
                ordered[window_size][0]
                if len(ordered) > window_size
                else min(MAX_POSITION, left + (len(selected) + 2) * POSITION_STEP)
            )
            step = (boundary - left) // (len(selected) + 2)
            if step:
                for rank, (_position, key) in enumerate(selected, 2):
                    self.current[key]["position"] = left + rank * step
                    self.relocated.add(key)
                return left, left + 2 * step
            if len(ordered) <= window_size:
                raise NoteContentInvalid
            window_size *= 2

    async def place(self, identifier, parent, after) -> None:
        if parent == identifier or after == identifier:
            raise NoteContentInvalid
        await self.load([identifier, parent, after])
        if (
            identifier not in self.current
            or parent is not None
            and parent not in self.current
        ):
            raise NoteContentInvalid
        if after is not None and (
            after not in self.current
            or not self.current[after]["placed"]
            or self.current[after]["parent_id"] != parent
        ):
            raise NoteContentInvalid
        target = self.current[identifier]
        left = self.current[after]["position"] if after is not None else 0
        next_item = await self.neighbor(parent, after, identifier)
        right = next_item[0] if next_item is not None else left + 2 * POSITION_STEP
        if (
            target["placed"]
            and target["parent_id"] == parent
            and left < target["position"] < right
        ):
            return
        if right - left <= 1 or right > MAX_POSITION:
            left, right = await self.rebalance(parent, identifier, after)
        target.update(parent_id=parent, position=(left + right) // 2, placed=True)
        self.relocated.add(identifier)

    async def remove_tree(self, deletes: list[str]) -> set[str]:
        await self.load(deletes)
        if not set(deletes) <= set(self.before):
            raise NoteContentInvalid
        removed: set[str] = set()
        wave = set(deletes)
        while wave:
            removed |= wave
            rows = []
            ordered = list(wave)
            for start in range(0, len(ordered), 500):
                query = self.query().where(
                    Block.parent_id.in_(ordered[start : start + 500])
                )
                if self.relocated:
                    query = query.where(Block.block_id.not_in(self.relocated))
                rows.extend((await self.session.execute(query)).all())
            self.remember(rows)
            children = {row.block_id for row in rows} | {
                key for key in self.relocated if self.current[key]["parent_id"] in wave
            }
            wave = children - removed
        return removed

    async def validate(self, touched: set[str], removed: set[str]) -> None:
        for identifier in touched - removed:
            value = self.current[identifier]
            if not value["placed"]:
                raise NoteContentInvalid
            seen, child, parent = {identifier}, identifier, value["parent_id"]
            while parent is not None:
                if parent in seen or parent in removed:
                    raise NoteContentInvalid
                await self.load([parent])
                if parent not in self.current:
                    raise NoteContentInvalid
                allowed = [] if self.current[parent]["block_type"] == "drawing" else DOCUMENT_BLOCKS.get(
                    self.current[parent]["block_type"], {}
                ).get("children", "any")
                if (
                    allowed != "any"
                    and self.current[child]["block_type"] not in allowed
                ):
                    raise NoteContentInvalid
                seen.add(parent)
                child, parent = parent, self.current[parent]["parent_id"]
            # A type change may invalidate untouched, unloaded children.
            allowed = [] if value["block_type"] == "drawing" else DOCUMENT_BLOCKS.get(value["block_type"], {}).get(
                "children", "any"
            )
            if allowed != "any":
                excluded = removed | self.relocated | touched
                if await self.has_invalid_unloaded_child(identifier, allowed, excluded):
                    raise NoteContentInvalid
                if any(
                    child not in removed
                    and meta["parent_id"] == identifier
                    and meta["block_type"] not in allowed
                    for child, meta in self.current.items()
                ):
                    raise NoteContentInvalid

    async def has_invalid_unloaded_child(self, identifier, allowed, excluded) -> bool:
        query = self.query().where(Block.parent_id == identifier)
        if excluded:
            query = query.where(Block.block_id.not_in(excluded))
        if allowed:
            query = query.where(Block.block_type.not_in(allowed))
        return (await self.session.execute(query.limit(1))).first() is not None

    async def plan(self, upserts, moves, deletes) -> BlockChangePlan:
        identifiers = [raw.get("id") for raw in upserts]
        all_ids = [*identifiers, *deletes, *[move.get("id") for move in moves]]
        if any(
            not isinstance(key, str) or not key or len(key) > 512 for key in all_ids
        ):
            raise NoteContentInvalid
        if len(identifiers) != len(set(identifiers)) or len(deletes) != len(
            set(deletes)
        ):
            raise NoteContentInvalid
        await self.load(all_ids)
        payloads = {}
        try:
            for raw in upserts:
                if "children" in raw:
                    raise InvalidNoteContent("Block upserts must not contain a subtree")
                canonical = normalize_note_blocks(
                    {
                        "schema_version": 2,
                        "editor": "blocknote",
                        "blocks": [{**raw, "children": []}],
                    }
                )["blocks"][0]
                canonical.pop("children", None)
                identifier = canonical["id"]
                payloads[identifier] = canonical
                if identifier not in self.current:
                    self.current[identifier] = {
                        "row_id": None,
                        "parent_id": None,
                        "position": 0,
                        "placed": False,
                    }
                self.current[identifier]["block_type"] = canonical["type"]
            for move in moves:
                if move.get("after_id") in deletes:
                    raise NoteContentInvalid
                await self.place(
                    move["id"], move.get("parent_id"), move.get("after_id")
                )
        except InvalidNoteContent:
            raise NoteContentInvalid from None
        removed = await self.remove_tree(deletes) if deletes else set()
        touched = set(payloads) | self.relocated
        await self.validate(touched, removed)
        for identifier in removed:
            self.current.pop(identifier, None)
            payloads.pop(identifier, None)
        return BlockChangePlan(self.before, self.current, payloads, removed)


class LegacyBlockChangePlanner(SparseBlockChangePlanner):
    """Reuse mutation semantics against an immutable legacy JSON projection.

    The compatibility path already owns an in-memory manifest. All queries used
    by the native planner are adapted here; planning never activates storage or
    writes migration candidates into the database.
    """

    def __init__(self, records: list[dict[str, Any]]):
        self.before = {
            row["block_id"]: {
                "row_id": None,
                "parent_id": row["parent_id"],
                "position": row["position"],
                "block_type": row["block_type"],
                "placed": True,
            }
            for row in records
        }
        self.current = deepcopy(self.before)
        self.relocated: set[str] = set()

    async def load(self, identifiers) -> None:
        return None

    async def neighbor(self, parent, after, excluding: str):
        anchor = (self.current[after]["position"], after) if after is not None else None
        values = [
            (value["position"], key)
            for key, value in self.current.items()
            if key != excluding
            and value["placed"]
            and value["parent_id"] == parent
            and (anchor is None or (value["position"], key) > anchor)
        ]
        return min(values) if values else None

    async def rebalance(self, parent, excluding: str, after: str | None):
        left = self.current[after]["position"] if after is not None else 0
        values = sorted(
            (value["position"], key)
            for key, value in self.current.items()
            if key != excluding
            and value["placed"]
            and value["parent_id"] == parent
            and value["position"] > left
        )
        window_size = REBALANCE_WINDOW_SIZE
        while True:
            selected = values[:window_size]
            boundary = (
                values[window_size][0]
                if len(values) > window_size
                else min(MAX_POSITION, left + (len(selected) + 2) * POSITION_STEP)
            )
            step = (boundary - left) // (len(selected) + 2)
            if step:
                for rank, (_position, key) in enumerate(selected, 2):
                    self.current[key]["position"] = left + rank * step
                    self.relocated.add(key)
                return left, left + 2 * step
            if len(values) <= window_size:
                raise NoteContentInvalid
            window_size *= 2

    async def remove_tree(self, deletes: list[str]) -> set[str]:
        if not set(deletes) <= set(self.before):
            raise NoteContentInvalid
        removed, wave = set(), set(deletes)
        while wave:
            removed |= wave
            wave = {
                key for key, value in self.current.items() if value["parent_id"] in wave
            } - removed
        return removed

    async def has_invalid_unloaded_child(self, identifier, allowed, excluded) -> bool:
        # Every legacy record is already represented by the current overlay.
        return False
