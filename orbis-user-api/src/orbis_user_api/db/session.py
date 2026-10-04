from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from orbis_user_api.db.base import Base


def create_engine(database_url: str, database_schema: str | None = None) -> AsyncEngine:
    connect_args = {}
    if database_schema and database_url.startswith("postgresql+asyncpg"):
        connect_args["server_settings"] = {"search_path": database_schema}
    engine = create_async_engine(
        database_url, future=True, connect_args=connect_args, hide_parameters=True
    )
    if database_url.startswith("sqlite+aiosqlite"):
        event.listen(engine.sync_engine, "reset", _reset_sqlite_transaction)
    return engine


def _reset_sqlite_transaction(dbapi_connection, _connection_record, reset_state):
    # A lock timeout can leave SQLite's physical transaction open after a failed
    # COMMIT. SQLAlchemy has already closed its logical transaction and may skip
    # the normal pool rollback; never lend that physical transaction to a reader.
    if (
        not reset_state.terminate_only
        and dbapi_connection.driver_connection.in_transaction
    ):
        dbapi_connection.rollback()


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_models(engine: AsyncEngine) -> None:
    import orbis_user_api.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
