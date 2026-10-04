"""Idempotent, additive backfill outside the document-opening request path.

Run with an explicitly selected database URL environment variable. Schema
creation/migrations remain the environment operator's responsibility.
"""

import argparse
import asyncio
import logging
import os
import re
from uuid import UUID

from sqlalchemy import select

from orbis_user_api.application.block_content import BlockContentStore
from orbis_user_api.db.session import create_engine, create_session_factory
from orbis_user_api.models.note import Note, NoteContent
from orbis_user_api.models.note_block import NoteBlockDocument

logger = logging.getLogger(__name__)
BATCH_SIZE = 50


async def backfill(
    database_url: str,
    *,
    apply: bool,
    database_schema: str | None = None,
    note_ids: list[UUID] | None = None,
    batch_size: int = BATCH_SIZE,
) -> int:
    if not 1 <= batch_size <= 1000:
        raise ValueError("Batch size must be between 1 and 1000")
    if database_schema and not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", database_schema):
        raise ValueError("Database schema must be a simple SQL identifier")
    engine = create_engine(database_url, database_schema)
    factory = create_session_factory(engine)
    migrated = 0
    try:
        async with factory() as session:
            query = (
                select(Note)
                .join(NoteContent, NoteContent.note_id == Note.id)
                .where(
                    Note.note_type == "doc",
                    ~select(NoteBlockDocument.id)
                    .where(NoteBlockDocument.note_id == Note.id)
                    .exists(),
                )
                .order_by(Note.id)
            )
            if note_ids:
                query = query.where(Note.id.in_(note_ids))
            if not apply:
                from sqlalchemy import func

                count = await session.scalar(
                    select(func.count()).select_from(query.subquery())
                )
                logger.info("Block backfill preview: eligible_documents=%s", count)
                return int(count or 0)
            while True:
                notes = list(await session.scalars(query.limit(batch_size)))
                if not notes:
                    break
                for note in notes:
                    # A failure rolls back activation; it never silently switches
                    # authority or deletes the legacy migration backup.
                    await BlockContentStore(session, note).activate()
                    await session.commit()
                    migrated += 1
                    logger.info(
                        "Block backfill committed: note_id=%s count=%s",
                        note.id,
                        migrated,
                    )
        return migrated
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url-env",
        required=True,
        help="Name of an environment variable containing the explicitly selected database URL",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the additive backfill; default is a read-only preview",
    )
    parser.add_argument(
        "--database-schema",
        help="Explicit PostgreSQL schema; omitted uses the connection default",
    )
    parser.add_argument(
        "--note-id",
        action="append",
        type=UUID,
        dest="note_ids",
        help="Restrict migration to this document UUID; repeatable",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help="Documents selected per batch (1-1000)",
    )
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 1000:
        parser.error("Batch size must be between 1 and 1000")
    if args.database_schema and not re.fullmatch(
        r"[a-zA-Z_][a-zA-Z0-9_]*", args.database_schema
    ):
        parser.error("Database schema must be a simple SQL identifier")
    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        parser.error("The selected database URL environment variable is not set")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    count = asyncio.run(
        backfill(
            database_url,
            apply=args.apply,
            database_schema=args.database_schema,
            note_ids=args.note_ids,
            batch_size=args.batch_size,
        )
    )
    logger.info("Block backfill finished: applied=%s documents=%s", args.apply, count)


if __name__ == "__main__":
    main()
