from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from orbis_user_api.db.base import Base


def create_engine(database_url: str, database_schema: str | None = None) -> AsyncEngine:
    connect_args = {}
    if database_schema and database_url.startswith("postgresql+asyncpg"):
        connect_args["server_settings"] = {"search_path": database_schema}
    return create_async_engine(database_url, future=True, connect_args=connect_args)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_models(engine: AsyncEngine) -> None:
    import orbis_user_api.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
