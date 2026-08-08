from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from orbis_user_api.api.v1.router import api_router
from orbis_user_api.core.settings import Settings
from orbis_user_api.db.session import create_engine, create_session_factory, init_models
from orbis_user_api.services.storage import LocalFileStorage


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app_settings = settings or Settings()
        engine = create_engine(app_settings.database_url, app_settings.database_schema)
        app.state.settings = app_settings
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)
        app.state.storage = LocalFileStorage(app_settings.storage_dir)

        app_settings.storage_dir.mkdir(parents=True, exist_ok=True)
        if app_settings.auto_create_tables:
            await init_models(engine)
        try:
            yield
        finally:
            await engine.dispose()

    app = FastAPI(title="Orbis User API", version="0.1.0", lifespan=lifespan)
    app.include_router(api_router)

    @app.get("/healthz", tags=["system"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
