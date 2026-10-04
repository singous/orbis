import asyncio
import sqlite3

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from orbis_user_api.db.session import create_engine, create_session_factory


def test_failed_commit_cannot_return_an_open_physical_transaction_to_the_pool(tmp_path):
    """Use a real rollback-journal reader lock, not a mocked commit exception."""
    path = tmp_path / "locked.db"

    async def verify():
        engine = create_engine(f"sqlite+aiosqlite:///{path}")
        factory = create_session_factory(engine)
        try:
            async with engine.begin() as connection:
                await connection.execute(text("CREATE TABLE entries (value TEXT)"))
                await connection.execute(text("INSERT INTO entries VALUES ('initial')"))
            reader = sqlite3.connect(path)
            reader.execute("BEGIN")
            reader.execute("SELECT * FROM entries").fetchall()
            try:
                async with factory() as session:
                    connection = await session.connection()
                    driver = (await connection.get_raw_connection()).driver_connection
                    await session.execute(text("PRAGMA busy_timeout=20"))
                    await session.execute(text("INSERT INTO entries VALUES ('failed')"))
                    with pytest.raises(OperationalError, match="database is locked"):
                        await session.commit()
                    # A failed SQLite COMMIT leaves the DBAPI transaction open,
                    # although SQLAlchemy marks its logical transaction inactive.
                    assert driver.in_transaction
                assert not driver.in_transaction
            finally:
                reader.rollback()
                reader.close()
            async with factory() as session:
                assert (
                    await session.scalars(text("SELECT value FROM entries"))
                ).all() == ["initial"]
                await session.execute(text("INSERT INTO entries VALUES ('recovered')"))
                await session.commit()
            async with factory() as session:
                assert (
                    await session.scalars(text("SELECT value FROM entries"))
                ).all() == ["initial", "recovered"]
        finally:
            await engine.dispose()

    asyncio.run(verify())
