from uuid import UUID

from fastapi import Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_session
from orbis_user_api.application.integration_auth import (
    IntegrationPrincipal,
    error,
    integration_principal,
)
from orbis_user_api.application.library_imports import (
    begin_import,
    finalize_import,
    import_limits,
    import_public,
    owned_import,
    upload_chunk,
)
from orbis_user_api.schemas.integration import ImportBegin

router = ApiRouter(tags=["open-library-imports"])


@router.post("/imports/markdown", status_code=201)
async def begin(
    payload: ImportBegin,
    request: Request,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await begin_import(
        payload, principal, session, request.app.state.settings, request.app
    )


@router.get("/imports/{import_id}")
async def status(
    import_id: UUID,
    request: Request,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return import_public(await owned_import(import_id, principal, session), request.app)


@router.put("/imports/{import_id}/chunks")
async def chunk(
    import_id: UUID,
    request: Request,
    offset: int = Query(ge=0),
    sha256: str = Query(pattern=r"^[0-9a-f]{64}$"),
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    maximum = import_limits(request.app.state.settings)["chunk_bytes"]
    data = bytearray()
    async for incoming in request.stream():
        data.extend(incoming)
        if len(data) > maximum:
            raise error(
                413,
                "IMPORT_CHUNK_BUDGET_EXCEEDED",
                "单块超出实例限制",
                {"max_bytes": maximum},
            )
    return await upload_chunk(
        import_id,
        offset,
        sha256,
        bytes(data),
        principal,
        session,
        request.app.state.storage,
        request.app.state.settings,
        request.app,
    )


@router.post("/imports/{import_id}/finalize", status_code=202)
async def finalize(
    import_id: UUID,
    request: Request,
    principal: IntegrationPrincipal = Depends(integration_principal),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await finalize_import(import_id, principal, session, request.app)
