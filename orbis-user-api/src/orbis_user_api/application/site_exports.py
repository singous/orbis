"""Portable machine-readable views of an authorized public release."""

from __future__ import annotations

import re
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlsplit
from xml.sax.saxutils import escape

from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.application.site_urls import PublicUrlPolicy, _origin
from orbis_user_api.domain.markdown_urls import markdown_destination
from orbis_user_api.domain.note_content import blocks_to_markdown
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut

PUBLIC_ASSET_PATH = re.compile(
    r"^/public/sites/[a-z0-9]+(?:-[a-z0-9]+)*/assets/[0-9a-f]{64}$"
)
PUBLIC_PAGE_PATH = re.compile(
    r"^/s/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*(?:#[a-zA-Z0-9_-]+)?$"
)


def canonical_base(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or "\\" in value
        or any(ord(char) <= 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError(
            "user_web_base_url must be an HTTP(S) URL without credentials, query or fragment"
        )
    # Reuse the public URL parser's browser-compatible authority validation.
    _origin(parsed)
    return value.rstrip("/")


def site_path(slug: str, page: str | None = None) -> str:
    base = "/s/" + quote(slug, safe="")
    return base + (
        "/" + "/".join(quote(part, safe="") for part in page.split("/")) if page else ""
    )


def public_url(value: Any, base: str, *, media: bool = False) -> str | None:
    if not isinstance(value, str):
        return None
    if PUBLIC_ASSET_PATH.fullmatch(value) or (
        not media and PUBLIC_PAGE_PATH.fullmatch(value)
    ):
        return base + value
    try:
        return PublicUrlPolicy.for_app(base, base).validate(value, media=media)
    except (SiteError, ValueError):
        return None


def markdown_label(value: str) -> str:
    for char in ("\\", "[", "]", "*", "_", "<", ">"):
        value = value.replace(char, "\\" + char)
    return value.replace("\r", " ").replace("\n", " ")


def _portable_blocks(value: Any, base: str) -> Any:
    if isinstance(value, list):
        return [_portable_blocks(item, base) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _portable_blocks(item, base) for key, item in value.items()}
    # Rewrite only schema URL fields. Never rewrite code or ordinary text.
    for key in ("href", "url"):
        if key in result and isinstance(result[key], str):
            raw = result[key]
            if PUBLIC_ASSET_PATH.fullmatch(raw) or PUBLIC_PAGE_PATH.fullmatch(raw):
                result[key] = base + raw
    return result


def page_markdown(page: SitePageOut, base: str) -> str:
    blocks = _portable_blocks(deepcopy(page.blocks), base)
    body = blocks_to_markdown(blocks)
    return (
        "\n\n".join(
            part
            for part in ["# " + markdown_label(page.title), page.description, body]
            if part
        )
        + "\n"
    )


def sitemap(snapshot: SiteSnapshotOut, base: str) -> str:
    urls = []
    for page in snapshot.pages:
        stamp = page.updated_at_ms or snapshot.published_at_ms
        modified = (
            datetime.fromtimestamp(stamp / 1000, UTC)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
            if stamp
            else None
        )
        urls.append(
            "<url><loc>"
            + escape(base + site_path(snapshot.slug, page.slug))
            + "</loc>"
            + (f"<lastmod>{modified}</lastmod>" if modified else "")
            + "</url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>\n"
    )


def robots(snapshot: SiteSnapshotOut, base: str) -> str:
    return f"User-agent: *\nAllow: {site_path(snapshot.slug)}/\nSitemap: {base}{site_path(snapshot.slug)}/sitemap.xml\n"


def llms(snapshot: SiteSnapshotOut, base: str) -> str:
    lines = [
        "# " + markdown_label(snapshot.name),
        "",
        "> " + snapshot.description.replace("\n", " "),
        "",
        "## 文档",
        "",
    ]
    for page in snapshot.pages:
        url = (
            base
            + site_path(snapshot.slug)
            + "/pages/"
            + "/".join(quote(part, safe="") for part in page.slug.split("/"))
            + ".md"
        )
        description = (
            (": " + page.description.replace("\n", " ")) if page.description else ""
        )
        lines.append(
            f"- [{markdown_label(page.title)}]({markdown_destination(url)}){description}"
        )
    return "\n".join(lines) + "\n"


def llms_full(snapshot: SiteSnapshotOut, base: str) -> str:
    return (
        llms(snapshot, base)
        + "\n---\n\n"
        + "\n---\n\n".join(page_markdown(page, base) for page in snapshot.pages)
    )
