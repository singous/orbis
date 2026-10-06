"""Document-scoped table APIs; public reads use the existing share scope."""

from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import ApiRouter
from orbis_user_api.api.deps import get_current_user, get_session
from orbis_user_api.api.errors import ApiError
from orbis_user_api.application import data_tables as service
from orbis_user_api.application.document_shares import resolve_share, ShareUnavailable
from orbis_user_api.application.data_table_exports import export_table
from orbis_user_api.domain.data_tables import InvalidTable
from orbis_user_api.models.data_table import DataTable
from orbis_user_api.models.user import User
from orbis_user_api.schemas.data_table import (
    MAX_PAGE_RECORDS,
    TableCreate,
    TableMutation,
    TableMutationOut,
    TablePage,
)
from orbis_user_api.services.exceptions import (
    NoteNotFound,
    NoteVersionConflict,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
)

router = ApiRouter(tags=["data-tables"])
export_router = APIRouter(tags=["data-tables"])


@asynccontextmanager
async def table_errors(session):
    try:
        yield
    except (NoteNotFound, ShareUnavailable):
        await session.rollback()
        raise ApiError(
            status_code=404, code="DATA_TABLE_NOT_FOUND", message="表格不存在或无权访问"
        ) from None
    except (WorkspaceMemberForbidden, UserWorkspaceMissing):
        await session.rollback()
        raise ApiError(
            status_code=403, code="DATA_TABLE_FORBIDDEN", message="没有操作此表格的权限"
        ) from None
    except NoteVersionConflict:
        await session.rollback()
        raise ApiError(
            status_code=409,
            code="NOTE_VERSION_CONFLICT",
            message="文档或表格已更新，本地修改已保留，请重新载入后重试",
        ) from None
    except InvalidTable as error:
        await session.rollback()
        raise ApiError(
            status_code=422, code="DATA_TABLE_INVALID", message=str(error)
        ) from None


@router.post(
    "/notes/{note_id}/tables",
    response_model=TableMutationOut,
    status_code=201,
    summary="在文档块中创建多维表格",
)
async def create_table(
    note_id: UUID,
    payload: TableCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with table_errors(session):
        return await service.create_table(note_id, payload, user, session)


@router.get(
    "/notes/{note_id}/tables/{table_id}",
    response_model=TablePage,
    summary="读取多维表格视图及记录页",
)
async def read_table(
    note_id: UUID,
    table_id: UUID,
    view_id: UUID | None = None,
    expected_revision: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE_RECORDS),
    group: str | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with table_errors(session):
        note, table = await service.authorize_table(note_id, table_id, user, session)
        return await service.read_table(
            note,
            table,
            session,
            view_id=view_id,
            offset=offset,
            limit=limit,
            expected_revision=expected_revision,
            group=group,
        )


@router.patch(
    "/notes/{note_id}/tables/{table_id}",
    response_model=TableMutationOut,
    summary="原子保存字段、视图及记录变更",
)
async def mutate_table(
    note_id: UUID,
    table_id: UUID,
    payload: TableMutation,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with table_errors(session):
        return await service.mutate_table(note_id, table_id, payload, user, session)


@export_router.get(
    "/notes/{note_id}/tables/{table_id}/export",
    summary="导出完整视图为 CSV 或 Markdown",
    response_class=Response,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string"}}, "text/markdown": {"schema": {"type": "string"}}}}},
)
async def export(
    note_id: UUID,
    table_id: UUID,
    format: Literal["csv", "markdown"] = "csv",
    view_id: UUID | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with table_errors(session):
        note, table = await service.authorize_table(note_id, table_id, user, session)
        body = await export_table(note, table, session, format, view_id)
        return Response(
            body,
            media_type="text/csv; charset=utf-8"
            if format == "csv"
            else "text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="table.{"csv" if format == "csv" else "md"}"'
            },
        )


@router.get(
    "/notes/{note_id}/tables/{table_id}/export-text",
    response_model=dict[str, str],
    summary="读取完整视图导出文本",
)
async def export_text(
    note_id: UUID,
    table_id: UUID,
    format: Literal["csv", "markdown"] = "csv",
    view_id: UUID | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    async with table_errors(session):
        note, table = await service.authorize_table(note_id, table_id, user, session)
        return {"content": await export_table(note, table, session, format, view_id)}


@router.get(
    "/public/shares/{token}/notes/{note_id}/tables/{table_id}",
    response_model=TablePage,
    summary="读取实时分享中授权公开的表格记录",
)
async def shared_table(
    token: str,
    note_id: UUID,
    table_id: UUID,
    request: Request,
    response: Response,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=MAX_PAGE_RECORDS),
    expected_revision: int | None = Query(None, ge=1),
    session: AsyncSession = Depends(get_session),
):
    response.headers["Cache-Control"] = "private, no-store"
    async with table_errors(session):
        scope = await resolve_share(token, session)
        note = await scope.note(note_id, session)
        table = await session.get(DataTable, table_id)
        if (
            table is None
            or table.note_id != note.id
            or table.workspace_id != note.workspace_id
        ):
            raise ShareUnavailable
        return await service.read_table(
            note,
            table,
            session,
            offset=offset,
            limit=limit,
            expected_revision=expected_revision,
            public=True,
        )
