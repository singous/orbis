"""Explicit public delivery documentation, including the text success exceptions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

JSON_PATHS = {
    "/public/sites/{slug}/manifest": "仅返回当前发布版本的站点配置和导航元数据，不包含任何页面正文或搜索文本。",
    "/public/sites/{slug}/pages/{page_slug}": "返回当前发布版本 UUID 与指定页面的完整公开正文。支持按路径段编码的层级路径。",
    "/public/sites/{slug}/search": "返回当前发布版本 UUID 与全部页面的纯文本搜索索引，包含所有标签页和代码示例，不包含结构化正文。",
}
TEXT_PATHS = {
    "/s/{slug}/sitemap.xml": (
        "application/xml",
        "返回当前公开页面的规范 URL 与最后更新时间。",
    ),
    "/s/{slug}/robots.txt": (
        "text/plain",
        "返回此公开站点的抓取规则与 sitemap 位置；标准爬虫的全局抓取规则由根路径 robots.txt 提供。",
    ),
    "/s/{slug}/llms.txt": (
        "text/plain",
        "返回站点简介与全部公开 Markdown 页面的目录。",
    ),
    "/s/{slug}/llms-full.txt": (
        "text/plain",
        "返回当前公开站点的全部页面 Markdown，含嵌套内容与所有标签页。",
    ),
    "/s/{slug}/pages/{page_slug}.md": (
        "text/markdown",
        "返回指定公开页面的 Markdown，受控媒体和页面引用转换为可移植的绝对地址。",
    ),
}


def install_site_delivery_docs(
    schema: dict[str, Any],
    add_error: Callable[..., None],
    envelope: Callable[..., dict],
) -> None:
    for path in [*JSON_PATHS, *TEXT_PATHS]:
        operation = schema["paths"][path]["get"]
        direct = path in TEXT_PATHS
        description = TEXT_PATHS[path][1] if direct else JSON_PATHS[path]
        response = (
            "成功时直接返回 "
            + TEXT_PATHS[path][0]
            + " 原始文本，不使用 JSON 成功信封。"
            if direct
            else "成功响应统一使用 code、message、request_id、data 信封，业务结果位于 data。"
        )
        operation["description"] = (
            description
            + "\n\n匿名读取，无需登录；只读取活动发布版本，站点撤回或页面不存在时返回 404。"
            "\n\n可传 expected_release_id 校验当前版本；不匹配返回 409 SITE_RELEASE_CHANGED，请刷新页面。此参数不会读取保留的历史版本。"
            "\n\n**响应格式**\n\n"
            + response
            + "\n所有错误均使用 code、message、request_id、data JSON 信封；request_id 可用于日志追踪。响应禁止缓存（no-store）。"
        )
        for parameter in operation.get("parameters", []):
            parameter["description"] = {
                "slug": "站点公开路径，仅使用小写英文、数字和连字符",
                "page_slug": "公开页面路径，可用斜杠分隔层级，路径段需进行 URL 编码",
                "expected_release_id": "期望的活动发布版本 UUID；已切换时返回 409，请刷新后重试",
            }[parameter["name"]]
        for status, code, message in (
            (404, "SITE_NOT_FOUND", "站点不存在或尚未发布"),
            (404, "SITE_PAGE_NOT_FOUND", "公开页面不存在或尚未发布"),
            (409, "SITE_RELEASE_CHANGED", "站点发布版本已更新，请刷新页面后重试"),
            (422, "VALIDATION_ERROR", "请求字段校验失败"),
            (500, "INTERNAL_ERROR", "服务内部错误"),
        ):
            if status == 422:
                operation["responses"].pop("422", None)
            add_error(operation, status, code, message)
        operation["responses"]["200"]["description"] = (
            "成功读取当前活动发布版本的公开内容"
        )
        if direct:
            operation["responses"]["200"]["content"] = {
                TEXT_PATHS[path][0]: {"schema": {"type": "string"}}
            }
        else:
            from orbis_user_api.api.openapi_base_mvp import SNAPSHOT
            from orbis_user_api.application.site_delivery import (
                manifest,
                page_delivery,
                search_index,
            )
            from orbis_user_api.schemas.site import SiteSnapshotOut

            snapshot = SiteSnapshotOut.model_validate(SNAPSHOT)
            result = (
                manifest(snapshot, "https://docs.example.com/s/" + snapshot.slug)
                if path.endswith("/manifest")
                else search_index(snapshot)
                if path.endswith("/search")
                else page_delivery(snapshot, None)
            )
            operation["responses"]["200"]["content"]["application/json"]["examples"] = {
                "success": {
                    "summary": "读取成功",
                    "value": envelope("OK", "请求成功", result.model_dump(mode="json")),
                }
            }
