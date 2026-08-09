from __future__ import annotations

import logging
import math
from contextvars import ContextVar
from functools import wraps
from inspect import isawaitable, signature
from time import perf_counter
from typing import Any, Generic, TypeVar
from uuid import UUID

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.datastructures import DefaultPlaceholder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import get_typed_return_annotation
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException

from orbis_user_api.api.errors import ApiError
from orbis_user_api.core.ids import new_uuidv7

logger = logging.getLogger(__name__)

T = TypeVar("T")

_request_id_context: ContextVar[UUID | None] = ContextVar(
    "orbis_request_id", default=None
)


class ApiResponse(BaseModel, Generic[T]):
    code: str = Field(description="稳定的业务状态码")
    message: str = Field(description="中文结果说明")
    request_id: UUID = Field(description="本次请求的 UUIDv7 追踪标识")
    data: T | None = Field(description="业务响应内容；无内容时为 null")


class Pagination(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int
    has_next: bool
    has_previous: bool


class PageData(BaseModel, Generic[T]):
    items: list[T]
    pagination: Pagination


class PaginationParams:
    def __init__(
        self,
        page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
        page_size: int = Query(
            default=20,
            ge=1,
            le=100,
            description="每页数量，范围 1 至 100",
        ),
    ) -> None:
        self.page = page
        self.page_size = page_size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class ApiRouter(APIRouter):
    def add_api_route(self, path: str, endpoint, **kwargs) -> None:
        response_model = kwargs.get("response_model")
        if isinstance(response_model, DefaultPlaceholder):
            response_model = get_typed_return_annotation(endpoint)
        if response_model is None:
            response_model = type(None)

        status_code = kwargs.get("status_code") or 200
        success_code = "CREATED" if status_code == 201 else "OK"
        success_message = "创建成功" if status_code == 201 else "请求成功"

        @wraps(endpoint)
        async def enveloped_endpoint(*args, **endpoint_kwargs):
            result = endpoint(*args, **endpoint_kwargs)
            if isawaitable(result):
                result = await result
            if isinstance(result, ApiResponse):
                return result
            return api_success(result, code=success_code, message=success_message)

        enveloped_endpoint.__signature__ = signature(endpoint)
        kwargs["response_model"] = ApiResponse[response_model]
        super().add_api_route(path, enveloped_endpoint, **kwargs)


def current_request_id() -> UUID:
    request_id = _request_id_context.get()
    if request_id is None:
        request_id = new_uuidv7()
        _request_id_context.set(request_id)
    return request_id


def api_success(
    data: T | None,
    *,
    message: str = "请求成功",
    code: str = "OK",
) -> ApiResponse[T]:
    return ApiResponse(
        code=code,
        message=message,
        request_id=current_request_id(),
        data=data,
    )


def build_page_data(
    items: list[T], *, page: int, page_size: int, total: int
) -> PageData[T]:
    total_pages = math.ceil(total / page_size) if total else 0
    return PageData(
        items=items,
        pagination=Pagination(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_previous=page > 1 and total_pages > 0,
        ),
    )


def _json_error(
    *,
    status_code: int,
    code: str,
    message: str,
    data: Any | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = current_request_id()
    payload = ApiResponse[Any](
        code=code,
        message=message,
        request_id=request_id,
        data=data,
    )
    response_headers = dict(headers or {})
    response_headers["X-Request-ID"] = str(request_id)
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(mode="json"),
        headers=response_headers,
    )


def _http_error_contract(status_code: int) -> tuple[str, str]:
    contracts = {
        400: ("INVALID_REQUEST", "请求内容不正确"),
        401: ("AUTH_REQUIRED", "请先登录"),
        403: ("ACCESS_FORBIDDEN", "没有权限执行此操作"),
        404: ("RESOURCE_NOT_FOUND", "请求的资源不存在"),
        409: ("RESOURCE_CONFLICT", "资源状态冲突"),
        422: ("VALIDATION_ERROR", "请求字段校验失败"),
        429: ("RATE_LIMIT_EXCEEDED", "请求过于频繁，请稍后重试"),
        503: ("SERVICE_UNAVAILABLE", "服务暂时不可用"),
    }
    return contracts.get(status_code, ("INTERNAL_ERROR", "服务内部错误"))


def _validation_message(error_type: str) -> str:
    messages = {
        "missing": "字段为必填项",
        "string_too_short": "字符串长度不足",
        "string_too_long": "字符串长度超出限制",
        "value_error": "字段值不正确",
        "int_parsing": "字段必须是整数",
        "greater_than_equal": "字段值低于允许范围",
        "less_than_equal": "字段值超出允许范围",
    }
    return messages.get(error_type, "字段值不符合要求")


def _validation_data(exc: RequestValidationError) -> dict[str, list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    for error in exc.errors():
        error_type = str(error.get("type", "validation_error"))
        location = ".".join(str(item) for item in error.get("loc", ()))
        errors.append(
            {
                "field": location,
                "code": error_type.upper().replace(".", "_"),
                "message": _validation_message(error_type),
            }
        )
    return {"errors": errors}


def install_api_contract(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = new_uuidv7()
        token = _request_id_context.set(request_id)
        started_at = perf_counter()
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = str(request_id)
            logger.info(
                "HTTP request completed",
                extra={
                    "request_id": str(request_id),
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round((perf_counter() - started_at) * 1000, 2),
                },
            )
            return response
        finally:
            _request_id_context.reset(token)

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return _json_error(
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            data=exc.data,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _json_error(
            status_code=422,
            code="VALIDATION_ERROR",
            message="请求字段校验失败",
            data=_validation_data(exc),
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(
        _request: Request, exc: HTTPException
    ) -> JSONResponse:
        code, message = _http_error_contract(exc.status_code)
        return _json_error(
            status_code=exc.status_code,
            code=code,
            message=message,
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception(
            "Unhandled API exception",
            extra={
                "request_id": str(current_request_id()),
                "method": request.method,
                "path": request.url.path,
            },
            exc_info=exc,
        )
        return _json_error(
            status_code=500,
            code="INTERNAL_ERROR",
            message="服务内部错误",
        )
