from __future__ import annotations


class SiteError(Exception):
    """Stable application errors for the site module's HTTP boundary."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def invalid_site_document() -> SiteError:
    return SiteError(
        "SITE_DOCUMENT_INVALID", "所选文档不存在、不属于当前空间或上级资源已归档", 422
    )


def unsafe_site_content() -> SiteError:
    return SiteError(
        "SITE_CONTENT_UNSAFE",
        "文档包含不支持的内容或不适合公开的链接，请检查后重新发布",
        422,
    )


def site_version_conflict() -> SiteError:
    return SiteError(
        "SITE_VERSION_CONFLICT", "站点配置或发布版本已更新，请刷新后重试", 409
    )


def site_slug_conflict() -> SiteError:
    return SiteError("SITE_SLUG_CONFLICT", "站点路径已被其他站点使用", 409)
