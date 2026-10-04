"""Document the live sharing and remote library contracts from their real routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

READING = "读取固定内容版本并返回有界结果。parent_id 选择根或容器，offset 与 limit 控制直接子块；max_bytes 同时约束正文和描述。未载入正文与后代由 descriptors 标记，不能解释为删除或空内容。后续页携带相同 expected_version，变化时按接口返回版本冲突。"
SCOPED = "使用限定工作空间的集成 Bearer 令牌。每次调用重新核对令牌状态、用户与成员权限及文集或文档范围；任何客户端提供的资源 ID 都不能扩大范围。X-Workspace-ID 若提供必须与令牌一致，省略时仍固定于令牌的工作空间。"
LIVE = "分享链接独立于站点发布，匿名读取对应笔记本或目录子树的当前活跃在线文档。新增和移入的后代进入范围；移出、归档、撤销后不再可访问。响应禁止缓存，范围外资源统一不可访问。"

DOCS: dict[tuple[str, str], tuple[str, str]] = {
    ("get", "/notes/{note_id}/content/children"): ("分页读取文档直接子块", READING),
    ("get", "/notes/{note_id}/blocks/{block_id}"): (
        "读取指定块完整正文",
        "校验文档权限并读取指定版本下一个块的完整自身正文；不递归展开全部后代。用于显式展开超过分页预算的块。返回 descriptor 与 content_version。",
    ),
    ("post", "/integrations/tokens"): (
        "创建受限集成令牌",
        "为当前工作空间创建个人集成令牌，声明 scopes、有效期及可选文集或单文档范围。原文仅创建时返回，服务端保存摘要；请求的写权限仍受当前成员权限约束。",
    ),
    ("get", "/integrations/tokens"): (
        "查询个人集成令牌",
        "列出当前用户与工作空间的最近集成令牌，最多100条，不返回令牌原文。",
    ),
    ("post", "/integrations/tokens/{token_id}/revoke"): (
        "撤销个人集成令牌",
        "仅当前工作空间中令牌所有者可撤销。重复撤销保持已撤销状态，后续集成访问立即被拒绝。",
    ),
    ("post", "/shares"): (
        "创建实时目录分享",
        LIVE
        + " 创建者必须具有资源管理权限并明确确认当前范围和未来新增文档公开。服务端签名配置不满足要求时返回503，不生成可猜测链接。",
    ),
    ("get", "/shares"): (
        "查询实时分享链接",
        "列出所选笔记本或目录的分享状态。已授权管理者可以恢复当前签名密钥生成的有效链接；密钥轮换或旧随机链接无法恢复时不返回错误链接，既有链接仍按摘要验证。",
    ),
    ("post", "/shares/{share_id}/revoke"): (
        "撤销实时分享链接",
        "校验当前资源管理权限后撤销链接，后续目录、正文和附件访问统一失效，重复撤销幂等。",
    ),
    ("get", "/public/shares/{token}"): ("匿名读取实时分享目录", LIVE),
    ("get", "/public/shares/{token}/notes/{note_id}/content"): (
        "匿名分页读取分享正文",
        LIVE + READING,
    ),
    ("get", "/public/shares/{token}/notes/{note_id}/blocks/{block_id}"): (
        "匿名展开分享内容块",
        LIVE + "只返回已授权文档中指定块的自身正文，并核对请求版本。",
    ),
    ("get", "/public/shares/{token}/notes/{note_id}/files/{file_id}"): (
        "匿名读取分享引用附件",
        LIVE
        + "只允许读取当前正文中实际引用且属于该工作空间的附件。成功响应为二进制，支持安全的媒体类型与文件响应头。",
    ),
}

OPEN_DOCS: dict[tuple[str, str], tuple[str, str]] = {
    ("post", "/imports/markdown"): (
        "开始可恢复大文档导入",
        SCOPED
        + "以稳定 operation_id 创建导入会话，声明 UTF-8 总字节和 SHA-256。只允许新增到授权文集，不替换存量文档。",
    ),
    ("get", "/imports/{import_id}"): (
        "查询大文档导入进度",
        SCOPED
        + "返回已接收字节、缺失范围及运行状态；超时不代表任务终止，不创建新会话重做。",
    ),
    ("put", "/imports/{import_id}/chunks"): (
        "提交幂等导入分片",
        SCOPED
        + "请求体为受预算约束的原始二进制，偏移和摘要校验重复分片一致性。分片无须在 UTF-8 或 Markdown 语法边界处分割。",
    ),
    ("post", "/imports/{import_id}/finalize"): (
        "完成原子大文档导入",
        SCOPED
        + "完整摘要与编码校验通过后后台解析，文档、内容、历史与回执原子提交。未完成或失败任务不生成可公开访问的部分文档；重复完成返回同一结果。",
    ),
    ("get", "/capabilities"): (
        "探测远程文档库能力",
        "返回协议、支持的操作、分页和批次预算；携带令牌时同时核对集成身份，未认证探测不暴露私人资源。",
    ),
    ("get", "/me"): ("查询集成身份和有效权限", SCOPED),
    ("get", "/workspaces"): (
        "查询令牌所属工作空间",
        SCOPED + "只返回绑定空间，不修改账号默认空间。",
    ),
    ("get", "/notebooks"): ("分页发现授权文集", SCOPED + "只列出授权范围内文集。"),
    ("get", "/notes"): (
        "分页发现授权文档",
        SCOPED + "按标题与派生内容搜索并返回有界摘要，cursor 支持继续读取。",
    ),
    ("get", "/search"): (
        "搜索授权文档内容",
        SCOPED + "返回稳定资源 ID 和有界摘要，不默认展开全文。",
    ),
    ("post", "/resolve"): (
        "解析文档名称或地址",
        SCOPED + "仅解析当前实例和授权范围中的对象；同名返回候选列表，不静默选择。",
    ),
    ("post", "/notes"): (
        "幂等创建远程文档",
        SCOPED
        + "创建文档或导入 Markdown，支持请求幂等标识与明确的目标文集。支持格式保持文字标记，不支持的原生组件以结构化 JSON 处理。",
    ),
    ("get", "/notes/{note_id}"): ("读取远程文档元数据", SCOPED),
    ("get", "/notes/{note_id}/outline"): (
        "分页读取远程文档目录",
        SCOPED + "按固定内容版本返回标题、块锚点和后续游标。",
    ),
    ("get", "/notes/{note_id}/blocks"): ("分页读取远程内容块", SCOPED + READING),
    ("get", "/notes/{note_id}/blocks/{block_id}"): (
        "精确读取远程内容块",
        SCOPED + "显式读取指定块自身正文；min_version 保证写后读取不会返回更早结果。",
    ),
    ("get", "/notes/{note_id}/export"): (
        "导出固定版本远程文档",
        SCOPED
        + "JSON 保持原生块结构与身份。Markdown 为交换格式，返回无法保持的组件、属性和样式损失清单，不宣称无损全文往返。",
    ),
    ("get", "/notes/{note_id}/changes"): (
        "查询远程文档变化",
        SCOPED + "返回指定版本边界之间的有界变更与删除标识，供客户端同步与核验。",
    ),
    ("post", "/notes/{note_id}/operations/preview"): (
        "预览远程文档编辑",
        SCOPED
        + "验证目标、严格 expected_version 和候选操作，只返回差异，不持久化正文、不保留排他锁。执行时必须重新验证。",
    ),
    ("post", "/notes/{note_id}/operations"): (
        "幂等提交远程文档编辑",
        SCOPED
        + "按序验证一批显式插入、修改、移动、删除或文本替换，内容、历史和操作回执同事务提交。相同 operation_id 与请求返回原结果，不同请求复用标识返回冲突。任一操作失败整批回滚。",
    ),
    ("get", "/operations/{operation_id}"): (
        "查询远程编辑持久化回执",
        SCOPED + "响应丢失后先查询回执；不得生成新操作标识盲目重做。",
    ),
    ("get", "/schema"): (
        "查询原生内容 Schema",
        SCOPED
        + "复用服务端块注册表返回类型、属性和浅层示例，未支持组件不能被客户端静默删除。",
    ),
    ("post", "/notes/{note_id}/files"): (
        "上传远程文档附件",
        SCOPED
        + "同时要求文件写入能力和目标文档权限。上传完成后返回资源 ID 与内容摘要，正文需要再通过显式操作引用。",
    ),
    ("get", "/notes/{note_id}/files/{file_id}"): (
        "读取远程附件元数据",
        SCOPED
        + "必须是绑定该文档或当前正文实际引用的附件，猜测其他文件 ID 不授予访问。",
    ),
    ("get", "/notes/{note_id}/files/{file_id}/content"): (
        "下载远程文档附件",
        SCOPED + "成功返回二进制文件；元数据与下载都执行相同资源范围校验。",
    ),
    ("get", "/shares"): (
        "查询远程实时分享",
        SCOPED + "额外要求 shares:manage，仅列出令牌范围内分享。",
    ),
    ("post", "/shares"): (
        "创建远程实时分享",
        SCOPED
        + LIVE
        + "额外要求 shares:manage 并明确确认公开范围。单文档令牌不能扩大成整个笔记本或目录子树。",
    ),
    ("post", "/shares/{share_id}/revoke"): (
        "撤销远程实时分享",
        SCOPED + "额外要求 shares:manage，不允许通过分享 ID 越过令牌范围。",
    ),
}
DOCS.update(
    {(method, "/open/v1" + path): value for (method, path), value in OPEN_DOCS.items()}
)


def install_document_platform_docs(
    schema: dict[str, Any], describe: Callable, error_response: Callable
) -> None:
    for (method, path), (summary, business) in DOCS.items():
        operation = schema["paths"].get(path, {}).get(method)
        if not operation:
            continue
        operation["tags"] = operation.get("tags", [])[-1:]
        operation["summary"] = summary
        operation["description"] = describe(method, path, business)
        public = path.startswith("/public/shares/") or path == "/open/v1/capabilities"
        if public:
            operation["description"] = operation["description"].replace(
                "必须在 Authorization 请求头中携带 `Bearer <access_token>`；部分写操作还要求资源管理权限。",
                "匿名读取无需登录凭据；链接权限与当前资源范围在每次请求中校验。",
            )
        elif path.startswith("/open/v1"):
            operation["description"] = operation["description"].replace(
                "`Bearer <access_token>`", "`Bearer <integration_token>`"
            )
        if (
            method == "get"
            and "/files/" not in path
            and (
                path.endswith("/blocks")
                or path.endswith("/children")
                or path.endswith("/content")
                or path.endswith("/outline")
            )
        ):
            operation["description"] = operation["description"].replace(
                "本接口不使用分页；业务结果直接位于 `data`。",
                "内容采用固定版本与有界分页；读取后续页使用响应游标或偏移，不能混入不同版本。",
            )
        for status, response in list(operation.get("responses", {}).items()):
            if status.isdigit() and int(status) >= 400:
                code = (
                    "VALIDATION_ERROR"
                    if status == "422"
                    else "RESOURCE_CONFLICT"
                    if status == "409"
                    else "RESOURCE_NOT_FOUND"
                    if status == "404"
                    else "INTERNAL_ERROR"
                )
                operation["responses"][status] = error_response(
                    int(status), code, "请求未成功，请根据业务码处理。"
                )
        for status, code, message in [
            (500, "INTERNAL_ERROR", "服务内部错误"),
            (404, "RESOURCE_NOT_FOUND", "资源不存在或无权访问"),
        ]:
            operation["responses"].setdefault(
                str(status), error_response(status, code, message)
            )
        if not public:
            for status, code, message in [
                (401, "AUTH_REQUIRED", "认证信息无效或已过期"),
                (403, "ACCESS_FORBIDDEN", "令牌或资源权限不足"),
            ]:
                operation["responses"].setdefault(
                    str(status), error_response(status, code, message)
                )
        if method in {"post", "patch", "put"}:
            operation["responses"].setdefault(
                "409",
                error_response(
                    409, "RESOURCE_CONFLICT", "版本、操作标识或目标状态冲突"
                ),
            )
