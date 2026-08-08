from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

EXAMPLE_REQUEST_ID = "019fe1e0-1234-7abc-8def-0123456789ab"

TAG_DOCS: dict[str, tuple[str, str]] = {
    "setup": ("系统初始化", "首次部署初始化"),
    "auth": ("身份认证", "登录与令牌续期"),
    "users": ("用户资料", "当前用户资料"),
    "workspace": ("工作空间", "工作空间成员与邀请"),
    "ownership": ("所有权转让", "工作空间所有权转让"),
    "document-groups": ("文档分组", "文档分组管理"),
    "notebooks": ("文集", "文集管理"),
    "notes": ("文档", "文档、内容、搜索与目录树"),
    "files": ("文件", "文件上传与查询"),
    "system": ("系统状态", "服务健康检查"),
}


# key: (HTTP method, route path); value: (Chinese summary, business description)
OPERATION_DOCS: dict[tuple[str, str], tuple[str, str]] = {
    ("post", "/setup"): ("初始化 Orbis", "首次部署时创建唯一所有者账号、默认私人工作空间和默认文档分组。该接口只能成功调用一次。"),
    ("get", "/workspace/mail-status"): ("查询邮件服务状态", "查询当前部署是否可以发送邀请和所有权转让邮件，不会返回 SMTP 密钥等敏感配置。"),
    ("post", "/workspace/invitations"): ("创建成员邀请", "向指定邮箱创建工作空间邀请并发送邮件。所有者可邀请管理员、编辑者和普通成员，管理员不可邀请管理员。"),
    ("get", "/workspace/invitations"): ("分页查询成员邀请", "分页查询当前工作空间的邀请记录，结果按创建时间倒序排列，响应不包含邀请密钥。"),
    ("delete", "/workspace/invitations/{invitation_id}"): ("撤销成员邀请", "撤销一条仍可操作的成员邀请。成功后 HTTP 状态为 200，统一响应中的 data 为 null。"),
    ("post", "/workspace/invitations/{invitation_id}/resend"): ("重新发送成员邀请", "轮换邀请密钥、重置有效期并重新发送邀请邮件；已过期或状态无效的邀请不能重新发送。"),
    ("post", "/workspace/invitations/accept"): ("接受成员邀请", "使用邮件中的一次性密钥加入工作空间。新账号需同时提交显示名称和密码，已有账号需先登录。"),
    ("get", "/workspace/members"): ("分页查询工作空间成员", "分页查询当前工作空间的活跃成员及其角色，结果按加入时间正序排列。"),
    ("patch", "/workspace/members/{member_id}"): ("修改成员角色", "修改指定成员的角色。所有者角色不可通过本接口修改，管理员之间也存在权限边界。"),
    ("delete", "/workspace/members/{member_id}"): ("移除工作空间成员", "移除指定成员但保留用户账号。成功后 HTTP 状态为 200，统一响应中的 data 为 null。"),
    ("get", "/workspace/ownership-transfers/current"): ("查询待处理所有权转让", "查询当前工作空间正在等待确认的所有权转让，不返回邮件确认密钥。"),
    ("post", "/workspace/ownership-transfers"): ("发起所有权转让", "由当前所有者向一名活跃管理员发起所有权转让，并发送一次性确认邮件。同一时间只能有一条待处理记录。"),
    ("delete", "/workspace/ownership-transfers/{transfer_id}"): ("取消所有权转让", "由当前所有者取消待处理的所有权转让。成功后 HTTP 状态为 200，统一响应中的 data 为 null。"),
    ("post", "/workspace/ownership-transfers/{transfer_id}/resend"): ("重新发送所有权转让邮件", "轮换确认密钥、重置有效期并重新发送所有权转让确认邮件。"),
    ("post", "/workspace/ownership-transfers/confirm"): ("确认所有权转让", "使用邮件中的一次性密钥确认接管工作空间。成功后目标管理员成为唯一所有者，原所有者降级为管理员。"),
    ("get", "/notes"): ("分页查询或搜索文档", "按标题和从结构化内容派生的纯文本分页检索文档；不传 q 时返回当前状态下的文档列表。"),
    ("post", "/notes"): ("创建文档", "在指定文集中创建文档元数据和初始结构化内容，可指定父文档及同级排序值。"),
    ("post", "/notes/import/markdown"): ("导入 Markdown 文档", "将 Markdown 转换为受支持的结构化块并创建文档；不支持的结构会返回内容校验错误。"),
    ("get", "/notes/{note_id}"): ("查询文档元数据", "读取指定文档的标题、层级、排序、归档状态和时间字段，不包含结构化正文。"),
    ("patch", "/notes/{note_id}"): ("修改文档元数据", "修改文档标题、父文档或同级排序值。父文档必须位于同一文集且不能形成循环。"),
    ("get", "/notes/{note_id}/content"): ("查询文档内容", "读取文档的结构化块、派生纯文本和当前内容版本号。"),
    ("put", "/notes/{note_id}/content"): ("保存文档内容", "使用 expected_version 执行乐观锁保存。版本不一致时返回 NOTE_VERSION_CONFLICT，客户端应刷新后处理冲突。"),
    ("get", "/notes/{note_id}/markdown"): ("导出 Markdown 文档", "将当前结构化文档内容转换为 Markdown，并返回建议文件名和文本内容。"),
    ("post", "/notes/{note_id}/archive"): ("归档文档", "归档指定文档；归档父文档后，其子树不会出现在活跃文档树中。"),
    ("post", "/notes/{note_id}/restore"): ("恢复文档", "恢复指定文档。文集、文档分组以及全部父文档必须已经恢复。"),
    ("get", "/notebooks/{notebook_id}/notes/tree"): ("查询文档目录树", "一次性返回指定文集的活跃文档树，子节点位于 children 字段。树接口不分页。"),
    ("post", "/auth/login"): ("账号登录", "使用邮箱和密码登录，返回访问令牌、刷新令牌、用户信息和当前工作空间。"),
    ("post", "/auth/refresh"): ("刷新访问令牌", "使用有效刷新令牌换取新的短期访问令牌；刷新令牌无效、过期或成员资格失效时拒绝刷新。"),
    ("get", "/users/me"): ("查询当前用户", "根据 Bearer 访问令牌返回当前登录用户的基础资料和当前工作空间标识。"),
    ("get", "/document-groups"): ("分页查询文档分组", "分页查询当前工作空间的文档分组，可通过 status 在活跃和已归档资源之间切换。"),
    ("post", "/document-groups"): ("创建文档分组", "在当前工作空间创建文档分组，并设置显示名称和排序值。"),
    ("patch", "/document-groups/{group_id}"): ("修改文档分组", "修改指定文档分组的名称或排序值。"),
    ("post", "/document-groups/{group_id}/archive"): ("归档文档分组", "归档指定文档分组。系统默认分组不可归档。"),
    ("post", "/document-groups/{group_id}/restore"): ("恢复文档分组", "恢复指定文档分组；恢复后其下级文集和文档仍需按依赖顺序分别恢复。"),
    ("get", "/notebooks"): ("分页查询文集", "分页查询当前工作空间的文集，可按文档分组、资源状态及父级状态过滤。"),
    ("post", "/notebooks"): ("创建文集", "在指定文档分组中创建文集；未指定 group_id 时自动使用默认文档分组。"),
    ("patch", "/notebooks/{notebook_id}"): ("修改文集", "修改文集标题、所属文档分组或排序值。目标文档分组必须处于活跃状态。"),
    ("post", "/notebooks/{notebook_id}/archive"): ("归档文集", "归档指定文集，归档后其中的文档不会出现在活跃列表和目录树中。"),
    ("post", "/notebooks/{notebook_id}/restore"): ("恢复文集", "恢复指定文集；所属文档分组必须已经恢复。"),
    ("post", "/files"): ("上传文件", "以 multipart/form-data 上传文件，保存文件元数据、大小和 SHA-256 摘要，并返回已创建的文件记录。"),
    ("get", "/files"): ("分页查询文件", "分页查询当前用户上传的文件，结果按创建时间倒序排列。"),
    ("get", "/healthz"): ("检查服务健康状态", "用于部署探针和人工诊断的轻量健康检查，不依赖登录态。"),
}

PUBLIC_OPERATIONS = {
    ("post", "/setup"),
    ("post", "/auth/login"),
    ("post", "/auth/refresh"),
    ("post", "/workspace/invitations/accept"),
    ("post", "/workspace/ownership-transfers/confirm"),
    ("get", "/healthz"),
}

PAGINATED_PATHS = {
    "/notes",
    "/document-groups",
    "/notebooks",
    "/files",
    "/workspace/invitations",
    "/workspace/members",
}

FIELD_DESCRIPTIONS = {
    "email": "登录或邀请使用的邮箱地址；服务端会去除首尾空格并转换为小写。",
    "password": "账号密码。初始化和新账号创建时长度至少为 8 位。",
    "display_name": "用户显示名称；允许为空的响应字段表示尚未设置。",
    "access_token": "Bearer 访问令牌，用于 Authorization 请求头。",
    "refresh_token": "刷新令牌，用于访问令牌过期后的续期。",
    "token_type": "令牌类型，固定为 bearer。",
    "id": "资源 UUIDv7 标识。",
    "tenant_id": "租户 UUIDv7 标识；社区版私人空间通常为 null。",
    "workspace_id": "资源所属工作空间 UUIDv7 标识。",
    "owner_id": "资源创建者或所有者 UUIDv7 标识。",
    "user_id": "用户 UUIDv7 标识。",
    "current_workspace_id": "用户当前选择的工作空间 UUIDv7 标识。",
    "name": "资源显示名称。",
    "title": "文集或文档标题。",
    "role": "工作空间角色：owner、admin、editor 或 normal。",
    "status": "资源当前状态；具体可选值随接口而定。",
    "created_at_ms": "创建时间，毫秒级 Unix 时间戳。",
    "updated_at_ms": "最后更新时间，毫秒级 Unix 时间戳。",
    "expires_at_ms": "过期时间，毫秒级 Unix 时间戳。",
    "notebook_id": "文集 UUIDv7 标识。",
    "group_id": "文档分组 UUIDv7 标识。",
    "parent_id": "父文档 UUIDv7 标识；根文档为 null。",
    "sort_order": "同级资源排序值，数值越小越靠前。",
    "note_type": "文档类型；当前普通文档为 doc。",
    "blocks": "符合 Orbis 编辑器契约的结构化文档块。",
    "plain_text": "由结构化文档块派生的纯文本，用于搜索和摘要。",
    "content_version": "文档内容版本号，每次成功保存后递增。",
    "expected_version": "客户端预期的当前内容版本号，用于乐观锁冲突检测。",
    "markdown": "Markdown 格式的文档文本。",
    "filename": "导出或上传时使用的文件名。",
    "original_filename": "用户上传时的原始文件名。",
    "mime_type": "文件 MIME 类型。",
    "file_size": "文件大小，单位为字节。",
    "sha256": "文件内容的 SHA-256 十六进制摘要。",
    "items": "当前页的业务数据列表；树接口中为根节点列表。",
    "pagination": "分页元数据，包含当前页、每页数量、总数和前后页标记。",
    "page": "当前页码，从 1 开始。",
    "page_size": "每页数量，允许范围为 1 至 100。",
    "total": "符合当前筛选条件的记录总数。",
    "total_pages": "按 page_size 计算的总页数；无数据时为 0。",
    "has_next": "是否存在下一页。",
    "has_previous": "是否存在上一页。",
    "code": "稳定的业务状态码。成功常用 OK 或 CREATED，失败使用大写英文和下划线。",
    "message": "面向调用方的中文结果说明。",
    "request_id": "本次请求的 UUIDv7 追踪标识，与响应头 X-Request-ID 一致。",
    "data": "业务响应内容。列表和分页对象也放在此字段；无返回内容时为 null。",
}

SCHEMA_EXAMPLES: dict[str, dict[str, Any]] = {
    "LoginRequest": {"email": "owner@example.com", "password": "correct horse battery staple"},
    "RefreshRequest": {"refresh_token": "eyJhbGciOiJIUzI1NiJ9.example"},
    "SetupRequest": {"email": "owner@example.com", "password": "correct horse battery staple", "display_name": "Orbis Owner"},
    "DocumentGroupCreateRequest": {"name": "产品研发", "sort_order": 10},
    "DocumentGroupUpdateRequest": {"name": "产品与研发", "sort_order": 20},
    "NotebookCreateRequest": {"title": "Orbis 产品文档", "group_id": "019fe1e0-1234-7abc-8def-012345678901", "sort_order": 10},
    "NotebookUpdateRequest": {"title": "Orbis 产品与技术文档", "sort_order": 20},
    "NoteCreateRequest": {"notebook_id": "019fe1e0-1234-7abc-8def-012345678901", "title": "统一接口规范", "parent_id": None, "sort_order": 10},
    "NoteMetadataUpdateRequest": {"title": "统一接口与错误码规范", "parent_id": None, "sort_order": 20},
    "NoteContentUpdateRequest": {"expected_version": 3, "blocks": {"schema_version": 1, "editor": "tiptap", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Orbis API 使用统一响应格式。"}]}]}}},
    "MarkdownImportRequest": {"notebook_id": "019fe1e0-1234-7abc-8def-012345678901", "title": "导入示例", "markdown": "# Orbis\n\n统一接口规范。", "parent_id": None, "sort_order": 10},
    "InvitationCreateRequest": {"email": "member@example.com", "role": "editor", "expires_in_seconds": 86400},
    "InvitationAcceptRequest": {"token": "一次性邀请密钥（至少 32 个字符）", "password": "correct horse battery staple", "display_name": "New Member"},
    "MemberRoleUpdateRequest": {"role": "editor"},
    "OwnershipTransferCreateRequest": {"target_member_id": "019fe1e0-1234-7abc-8def-012345678902"},
    "OwnershipTransferConfirmRequest": {"token": "一次性确认密钥（至少 32 个字符）"},
}


def _success_data(path: str, method: str) -> Any:
    if method == "delete":
        return None
    if path in PAGINATED_PATHS and method == "get":
        return {
            "items": [],
            "pagination": {
                "page": 1,
                "page_size": 20,
                "total": 0,
                "total_pages": 0,
                "has_next": False,
                "has_previous": False,
            },
        }
    if path == "/healthz":
        return {"status": "ok"}
    return {}


def _envelope(code: str, message: str, data: Any) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "request_id": EXAMPLE_REQUEST_ID,
        "data": data,
    }


def _error_response(status_code: int, code: str, message: str) -> dict[str, Any]:
    return {
        "description": f"{status_code} 业务错误：{message}",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ApiErrorResponse"},
                "examples": {
                    code: {
                        "summary": message,
                        "value": _envelope(code, message, None),
                    }
                },
            }
        },
    }


def _add_error_example(
    operation: dict[str, Any], status_code: int, code: str, message: str
) -> None:
    status_key = str(status_code)
    response = operation["responses"].setdefault(
        status_key,
        _error_response(status_code, code, message),
    )
    response["description"] = f"{status_code} 业务错误；具体原因见业务码示例"
    media_type = response.setdefault("content", {}).setdefault(
        "application/json", {}
    )
    media_type["schema"] = {"$ref": "#/components/schemas/ApiErrorResponse"}
    media_type.setdefault("examples", {})[code] = {
        "summary": message,
        "value": _envelope(code, message, None),
    }


def _operation_description(
    method: str, path: str, business_description: str
) -> str:
    auth_line = (
        "无需 Bearer 访问令牌；请按接口说明提交凭据或一次性密钥。"
        if (method, path) in PUBLIC_OPERATIONS
        else "必须在 Authorization 请求头中携带 `Bearer <access_token>`；部分写操作还要求资源管理权限。"
    )
    pagination_line = (
        "本接口使用统一分页：`page` 默认 1，`page_size` 默认 20、最大 100；分页元数据位于 `data.pagination`。"
        if path in PAGINATED_PATHS and method == "get"
        else "本接口不使用分页；业务结果直接位于 `data`。"
    )
    return (
        f"{business_description}\n\n"
        "**调用说明**\n\n"
        f"- {auth_line}\n"
        f"- {pagination_line}\n"
        "- 请求体和响应体均使用 UTF-8；除文件上传外，请使用 `application/json`。\n\n"
        "**响应格式**\n\n"
        "- 顶层固定为 `code`、`message`、`request_id`、`data`。\n"
        "- `code` 是稳定业务码，`message` 是中文说明，全部业务字段都放在 `data`。\n"
        "- `request_id` 与响应头 `X-Request-ID` 相同，可用于日志检索和问题排查。"
    )


def _install_component_docs(schema: dict[str, Any]) -> None:
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    components["ApiErrorResponse"] = {
        "type": "object",
        "required": ["code", "message", "request_id", "data"],
        "description": "统一错误响应。HTTP 状态表达协议结果，code 表达可供前端分支处理的业务原因。",
        "properties": {
            "code": {"type": "string", "description": FIELD_DESCRIPTIONS["code"], "example": "RESOURCE_NOT_FOUND"},
            "message": {"type": "string", "description": FIELD_DESCRIPTIONS["message"], "example": "请求的资源不存在"},
            "request_id": {"type": "string", "format": "uuid", "description": FIELD_DESCRIPTIONS["request_id"], "example": EXAMPLE_REQUEST_ID},
            "data": {"description": FIELD_DESCRIPTIONS["data"], "nullable": True, "example": None},
        },
    }
    for name, component in components.items():
        properties = component.get("properties", {})
        if isinstance(properties, dict):
            for field_name, field_schema in properties.items():
                if (
                    isinstance(field_schema, dict)
                    and field_name in FIELD_DESCRIPTIONS
                ):
                    field_schema.setdefault(
                        "description", FIELD_DESCRIPTIONS[field_name]
                    )
        if name in SCHEMA_EXAMPLES:
            component["example"] = SCHEMA_EXAMPLES[name]


def _install_operation_docs(schema: dict[str, Any]) -> None:
    for (method, path), (summary, business_description) in OPERATION_DOCS.items():
        operation = schema["paths"][path][method]
        operation["summary"] = summary
        operation["description"] = _operation_description(
            method, path, business_description
        )
        success_status = "201" if method == "post" and path in {
            "/setup",
            "/workspace/invitations",
            "/workspace/invitations/accept",
            "/workspace/ownership-transfers",
            "/notes",
            "/notes/import/markdown",
            "/document-groups",
            "/notebooks",
            "/files",
        } else "200"
        success = operation["responses"][success_status]
        success.setdefault("content", {}).setdefault("application/json", {})[
            "examples"
        ] = {
            "success": {
                "summary": "调用成功",
                "value": _envelope(
                    "CREATED" if success_status == "201" else "OK",
                    "创建成功" if success_status == "201" else "请求成功",
                    _success_data(path, method),
                ),
            }
        }

        responses = operation["responses"]
        _add_error_example(operation, 500, "INTERNAL_ERROR", "服务内部错误")
        if "422" in responses:
            responses["422"] = _error_response(
                422, "VALIDATION_ERROR", "请求字段校验失败"
            )
        if (method, path) not in PUBLIC_OPERATIONS:
            _add_error_example(operation, 401, "AUTH_REQUIRED", "请先登录")
            _add_error_example(
                operation, 403, "ACCESS_FORBIDDEN", "没有权限执行此操作"
            )
        if method in {"post", "put", "patch", "delete"}:
            _add_error_example(
                operation, 422, "VALIDATION_ERROR", "请求字段校验失败"
            )
            if (method, path) not in PUBLIC_OPERATIONS:
                _add_error_example(
                    operation, 409, "RESOURCE_CONFLICT", "资源状态冲突"
                )
        if "{" in path:
            _add_error_example(
                operation, 404, "RESOURCE_NOT_FOUND", "请求的资源不存在"
            )

    # Add route-specific business-code examples used by client branching.
    route_errors = [
        ("post", "/setup", 409, "SYSTEM_ALREADY_INITIALIZED", "系统已经完成初始化"),
        ("post", "/auth/login", 401, "INVALID_CREDENTIALS", "邮箱或密码错误"),
        ("post", "/auth/refresh", 401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期"),
        ("put", "/notes/{note_id}/content", 409, "NOTE_VERSION_CONFLICT", "文档内容版本冲突，请刷新后重试"),
        ("put", "/notes/{note_id}/content", 422, "NOTE_CONTENT_INVALID", "文档内容无效"),
        ("post", "/workspace/invitations/accept", 401, "INVITATION_ACCOUNT_AUTHENTICATION_REQUIRED", "请先登录受邀账号再接受邀请"),
        ("post", "/workspace/invitations/accept", 403, "INVITATION_ACCEPTANCE_FORBIDDEN", "无权接受此邀请"),
        ("post", "/workspace/invitations/accept", 409, "INVITATION_EXPIRED", "邀请已过期"),
        ("post", "/workspace/invitations/accept", 422, "INVITATION_ACCOUNT_PROFILE_REQUIRED", "新账号必须提供密码和显示名称"),
        ("post", "/workspace/ownership-transfers/confirm", 409, "OWNERSHIP_TRANSFER_EXPIRED", "所有权转让已过期"),
        ("post", "/workspace/invitations", 503, "MAIL_SERVICE_UNAVAILABLE", "邮件服务暂不可用"),
        ("post", "/workspace/invitations/{invitation_id}/resend", 503, "MAIL_SERVICE_UNAVAILABLE", "邮件服务暂不可用"),
        ("post", "/workspace/ownership-transfers", 503, "MAIL_SERVICE_UNAVAILABLE", "邮件服务暂不可用"),
        ("post", "/workspace/ownership-transfers/{transfer_id}/resend", 503, "MAIL_SERVICE_UNAVAILABLE", "邮件服务暂不可用"),
        ("post", "/document-groups/{group_id}/archive", 409, "DEFAULT_DOCUMENT_GROUP_ARCHIVE_FORBIDDEN", "默认文档分组不能归档"),
        ("post", "/notebooks/{notebook_id}/restore", 409, "ARCHIVE_RESTORE_DEPENDENCY_INACTIVE", "请先恢复上级文档分组"),
        ("post", "/notes/{note_id}/restore", 409, "ARCHIVE_RESTORE_DEPENDENCY_INACTIVE", "请先恢复所有上级资源"),
    ]
    for method, path, status_code, code, message in route_errors:
        _add_error_example(
            schema["paths"][path][method], status_code, code, message
        )


def _install_chinese_tags(schema: dict[str, Any]) -> None:
    schema["tags"] = [
        {"name": name, "description": description}
        for name, description in TAG_DOCS.values()
    ]
    for path_item in schema["paths"].values():
        for operation in path_item.values():
            if not isinstance(operation, dict) or "tags" not in operation:
                continue
            operation["tags"] = [
                TAG_DOCS[tag][0] for tag in operation["tags"]
            ]


def install_chinese_openapi(app: FastAPI) -> None:
    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = get_openapi(
            title="Orbis 用户服务 API",
            version="0.1.0",
            summary="Orbis 社区版用户、工作空间与在线文档接口",
            description=(
                "本接口文档使用中文维护。所有 JSON 接口统一返回 "
                "`code`、`message`、`request_id`、`data`，分页数据位于 `data.pagination`。"
            ),
            routes=app.routes,
        )
        _install_chinese_tags(schema)
        _install_component_docs(schema)
        _install_operation_docs(schema)
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi
