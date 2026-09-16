from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.application.site_assets import (
    FILE_REFERENCE_PREFIX,
    PublishedAsset,
    parse_file_reference,
    prepare_public_asset,
)
from orbis_user_api.application.site_errors import SiteError, unsafe_site_content
from orbis_user_api.application.site_sources import ResolvedPage, ResolvedSource
from orbis_user_api.application.site_urls import (
    PublicUrlPolicy,
    _normalized_path,
    _origin,
)
from orbis_user_api.domain.note_content import InvalidNoteContent, normalize_note_blocks
from orbis_user_api.models.site import Site
from orbis_user_api.services.storage import LocalFileStorage

NOTE_REFERENCE_PREFIX = "orbis-note:"
MEDIA_TYPES = frozenset({"image", "file", "audio", "video"})


@dataclass(frozen=True, slots=True)
class PreparedSiteReferences:
    rewrites: dict[tuple[str, bool], str]
    asset_manifest: dict[str, dict[str, Any]]


_prepared_references: ContextVar[PreparedSiteReferences | None] = ContextVar(
    "site_prepared_references", default=None
)


@contextmanager
def use_prepared_site_references(
    prepared: PreparedSiteReferences,
) -> Iterator[None]:
    token = _prepared_references.set(prepared)
    try:
        yield
    finally:
        _prepared_references.reset(token)


def validate_site_reference(
    value: Any, url_policy: PublicUrlPolicy, *, media: bool = False
) -> str:
    prepared = _prepared_references.get()
    key = (value, media)
    if prepared is not None and isinstance(value, str) and key in prepared.rewrites:
        return prepared.rewrites[key]
    return url_policy.validate(value, media=media)


def _reference_error(page_title: str, detail: str) -> SiteError:
    return SiteError(
        "SITE_REFERENCE_INVALID",
        f"页面「{page_title}」{detail}，请修正后重新发布",
        422,
    )


def _canonical_uuid(value: str) -> UUID | None:
    try:
        identifier = UUID(value)
    except (ValueError, AttributeError):
        return None
    return identifier if str(identifier) == value else None


def _inline_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_inline_text(item) for item in value)
    if not isinstance(value, dict):
        return ""
    if isinstance(value.get("text"), str):
        return value["text"]
    return _inline_text(value.get("content"))


def _heading_anchors(page: ResolvedPage) -> set[str]:
    try:
        blocks = normalize_note_blocks(page.blocks)
    except (InvalidNoteContent, TypeError, ValueError, RecursionError):
        raise unsafe_site_content() from None
    legacy = blocks["schema_version"] != 2
    roots = blocks["doc"].get("content", []) if legacy else blocks["blocks"]
    anchors: set[str] = set()

    def walk(items: Any, prefix: tuple[int, ...]) -> None:
        if not isinstance(items, list):
            return
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            path = (*prefix, index)
            duplicate_title = (
                len(path) == 1
                and path[0] == 0
                and _inline_text(item.get("content")).strip()
                == page.metadata.title.strip()
            )
            if item.get("type") == "heading" and not duplicate_title:
                anchors.add("heading-" + "-".join(str(part) for part in path))
            walk(item.get("content") if legacy else item.get("children"), path)

    walk(roots, ())
    return anchors


def _document_candidate(
    value: str, url_policy: PublicUrlPolicy
) -> tuple[str, str] | None:
    if not value or value != value.strip() or "\\" in value:
        return None
    if any(ord(char) < 33 or ord(char) == 127 for char in value):
        return None
    parsed = urlsplit(value)
    paths: set[str] = set()
    if not parsed.scheme and not parsed.netloc and parsed.path.startswith("/"):
        paths.add(_normalized_path(parsed.path))
    elif parsed.scheme in {"http", "https"} and parsed.hostname:
        try:
            value_origin = _origin(parsed)
        except ValueError:
            return None
        for app_origin, prefix in url_policy.internal_locations:
            if value_origin != app_origin:
                continue
            path = _normalized_path(parsed.path)
            paths.add(path)
            if prefix != "/" and path.startswith(prefix.rstrip("/") + "/"):
                paths.add(path[len(prefix.rstrip("/")) :])
    else:
        return None
    for path in tuple(paths):
        if path.startswith("/api/"):
            paths.add(path[4:])
    document_path = next(
        (path for path in paths if path.startswith("/documents/")), None
    )
    if document_path is None:
        return None
    if parsed.username is not None or parsed.password is not None or parsed.query:
        return "", parsed.fragment
    return document_path.removeprefix("/documents/"), parsed.fragment


def _note_reference(value: str) -> tuple[str, str] | None:
    if not value.startswith(NOTE_REFERENCE_PREFIX):
        return None
    reference = value[len(NOTE_REFERENCE_PREFIX) :]
    note_id, separator, fragment = reference.partition("#")
    if not note_id or (separator and not fragment) or "?" in note_id:
        return "", fragment
    return note_id, fragment


def _iter_references(value: Any) -> Iterator[tuple[str, bool]]:
    if isinstance(value, list):
        for item in value:
            yield from _iter_references(item)
        return
    if not isinstance(value, dict):
        return
    item_type = value.get("type")
    if item_type == "link" and isinstance(value.get("href"), str):
        yield value["href"], False
    if item_type == "link" and isinstance(value.get("attrs"), dict):
        href = value["attrs"].get("href")
        if isinstance(href, str):
            yield href, False
    props = value.get("props")
    if isinstance(props, dict):
        if item_type in MEDIA_TYPES and isinstance(props.get("url"), str):
            yield props["url"], True
        if item_type == "card" and isinstance(props.get("href"), str):
            yield props["href"], False
    for child in value.values():
        if isinstance(child, (dict, list)):
            yield from _iter_references(child)


async def prepare_site_references(
    site: Site,
    resolved: ResolvedSource,
    session: AsyncSession,
    storage: LocalFileStorage | None,
    *,
    url_policy: PublicUrlPolicy,
    preview: bool,
) -> PreparedSiteReferences:
    pages_by_id = {page.metadata.note_id: page for page in resolved.pages}
    anchors_by_id = {
        note_id: _heading_anchors(page) for note_id, page in pages_by_id.items()
    }
    rewrites: dict[tuple[str, bool], str] = {}
    manifest: dict[str, dict[str, Any]] = {}
    prepared_assets: dict[UUID, PublishedAsset] = {}

    async def prepare(value: str, media: bool, source_title: str) -> None:
        rewrite_key = (value, media)
        if rewrite_key in rewrites:
            return
        file_id = parse_file_reference(value)
        if value.startswith(FILE_REFERENCE_PREFIX):
            if file_id is None:
                raise _reference_error(source_title, "包含格式错误的内部文件引用")
            if storage is None:
                raise _reference_error(source_title, "引用的内部文件无法在当前环境校验")
            try:
                asset = prepared_assets.get(file_id)
                if asset is None:
                    asset = await prepare_public_asset(
                        file_id, site.workspace_id, session, storage
                    )
                    prepared_assets[file_id] = asset
            except SiteError as error:
                if error.status_code == 422:
                    raise _reference_error(
                        source_title, "引用了不可用或不属于当前空间的文件"
                    ) from None
                raise SiteError(
                    error.code,
                    f"页面「{source_title}」引用的文件无法安全发布，请重新上传后再试",
                    error.status_code,
                ) from None
            manifest[str(file_id)] = asset.as_dict()
            rewrites[rewrite_key] = (
                value
                if preview
                else f"/public/sites/{site.slug}/assets/{asset.key}"
            )
            return

        note_value = _note_reference(value)
        document_value = _document_candidate(value, url_policy)
        if note_value is not None or document_value is not None:
            if media:
                raise _reference_error(source_title, "把内部文档链接用作了媒体文件")
            raw_note_id, fragment = note_value or document_value or ("", "")
            note_id = _canonical_uuid(raw_note_id)
            target = pages_by_id.get(note_id) if note_id is not None else None
            if target is None:
                raise _reference_error(source_title, "引用了未选中或不可用的内部文档")
            if fragment and fragment not in anchors_by_id[note_id]:
                raise _reference_error(source_title, "引用了目标页面中不存在的标题位置")
            suffix = f"#{fragment}" if fragment else ""
            rewrites[rewrite_key] = f"/s/{site.slug}/{target.metadata.slug}{suffix}"
            return

        if value.startswith(NOTE_REFERENCE_PREFIX):
            raise _reference_error(source_title, "包含格式错误的内部文档引用")

    for page in resolved.pages:
        try:
            canonical = normalize_note_blocks(page.blocks)
        except (InvalidNoteContent, TypeError, ValueError, RecursionError):
            raise unsafe_site_content() from None
        for value, media in _iter_references(canonical):
            await prepare(value, media, page.metadata.title)

    branding = site.branding or {}
    logo_url = branding.get("logo_url")
    if isinstance(logo_url, str):
        await prepare(logo_url, True, "站点品牌")
    for group in ("links", "footer_links"):
        for link in branding.get(group, []):
            if isinstance(link, dict) and isinstance(link.get("url"), str):
                await prepare(link["url"], False, "站点品牌")
    cta = branding.get("cta")
    if isinstance(cta, dict) and isinstance(cta.get("url"), str):
        await prepare(cta["url"], False, "站点品牌")

    return PreparedSiteReferences(rewrites=rewrites, asset_manifest=manifest)
