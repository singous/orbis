from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

import orbis_user_api.models  # noqa: F401
from orbis_user_api.core.settings import Settings
from orbis_user_api.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = Settings()
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    migration_schema = settings.database_schema if connection.dialect.name == "postgresql" else None

    if migration_schema:
        quoted_schema = connection.dialect.identifier_preparer.quote_schema(migration_schema)
        connection.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")
        connection.commit()
        connection.exec_driver_sql(f"SET search_path TO {quoted_schema}")
        connection.commit()

    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=migration_schema,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
