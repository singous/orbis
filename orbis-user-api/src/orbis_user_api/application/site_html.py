"""Safe, crawlable first render and the built reader's minimal bootstrap."""

from __future__ import annotations

import json
import logging
import re
from html import escape
from pathlib import Path
from typing import Any

from orbis_user_api.application.site_delivery import manifest, page_delivery
from orbis_user_api.application.site_exports import public_url, site_path
from orbis_user_api.schemas.site import SitePageOut, SiteSnapshotOut

logger = logging.getLogger(__name__)
BUILT_ASSET = re.compile(
    r"^[\w./-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$"
)


def built_asset(dist: Path, name: str) -> Path | None:
    if not BUILT_ASSET.fullmatch(name) or any(
        part in {".", "..", ""} for part in name.split("/")
    ):
        return None
    assets = dist.resolve() / "assets"
    candidate = assets / name
    try:
        # Do not follow symlinks even if they currently resolve inside assets.
        if (
            candidate.resolve().is_relative_to(assets)
            and candidate.is_file()
            and not any(
                path.is_symlink()
                for path in [candidate, *candidate.parents]
                if path != assets.parent
            )
        ):
            return candidate
    except (OSError, ValueError):
        pass
    return None


def reader_bundle(dist: Path) -> str:
    try:
        entries = json.loads(
            (dist / ".vite" / "manifest.json").read_text(encoding="utf-8")
        )
        entry_key = next(
            key
            for key, value in entries.items()
            if value.get("isEntry") and key == "index.html"
        )
        entry_file = entries[entry_key]["file"]
        if not entry_file.startswith("assets/") or not built_asset(
            dist, entry_file[7:]
        ):
            raise ValueError("Entry asset is unavailable")
        css: list[str] = []
        visited: set[str] = set()

        def visit(key: str) -> None:
            if key in visited:
                return
            visited.add(key)
            item = entries.get(key, {})
            for dependency in item.get("imports", []):
                visit(dependency)
            for path in item.get("css", []):
                if (
                    path.startswith("assets/")
                    and built_asset(dist, path[7:])
                    and path not in css
                ):
                    css.append(path)

        visit(entry_key)
        for key, item in entries.items():
            if any(
                name in key or name in item.get("name", "")
                for name in ("PublicSitePage", "ContentRenderer")
            ):
                visit(key)
        return (
            "".join(
                f'<link rel="stylesheet" href="/{escape(path, quote=True)}">'
                for path in css
            )
            + f'<script type="module" crossorigin src="/{escape(entry_file, quote=True)}"></script>'
        )
    except (OSError, ValueError, TypeError, KeyError, StopIteration, AttributeError):
        logger.warning(
            "Public reader bundle unavailable in %s; serving readable HTML without JavaScript",
            dist,
        )
        return ""


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_text(item) for item in value)
    if isinstance(value, dict):
        return (
            str(value["text"])
            if isinstance(value.get("text"), str)
            else _text(value.get("content"))
        )
    return ""


def _integer(
    value: Any, default: int = 1, minimum: int = 1, maximum: int = 10000
) -> int:
    try:
        return max(minimum, min(maximum, int(value)))
    except (ValueError, TypeError, OverflowError):
        return default


class DocumentHtml:
    def __init__(self, base: str, title: str):
        self.base, self.title = base, title
        self.outline: list[tuple[str, str]] = []

    def link(self, url: Any, label: str) -> str:
        safe = public_url(url, self.base)
        return f'<a href="{escape(safe, quote=True)}">{label}</a>' if safe else label

    def inline(self, value: Any) -> str:
        if isinstance(value, str):
            return escape(value)
        if isinstance(value, list):
            return "".join(self.inline(item) for item in value)
        if not isinstance(value, dict):
            return ""
        if value.get("type") == "link":
            return self.link(value.get("href"), self.inline(value.get("content")))
        rendered = (
            escape(value["text"])
            if isinstance(value.get("text"), str)
            else self.inline(value.get("content"))
        )
        styles = dict(value.get("styles") or {})
        for mark in value.get("marks", []):
            kind = mark.get("type")
            if kind == "link":
                rendered = self.link(mark.get("attrs", {}).get("href"), rendered)
            else:
                styles[kind] = True
        for key, tag in (
            ("code", "code"),
            ("bold", "strong"),
            ("italic", "em"),
            ("underline", "u"),
            ("strike", "s"),
        ):
            if styles.get(key):
                rendered = f"<{tag}>{rendered}</{tag}>"
        return rendered

    def nodes(self, values: list, legacy: bool, prefix: tuple[int, ...] = ()) -> str:
        output: list[str] = []
        list_tag: str | None = None
        for index, item in enumerate(values):
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            tag = (
                "ol"
                if kind == "numberedListItem"
                else "ul"
                if kind in {"bulletListItem", "checkListItem"}
                else None
            )
            if tag != list_tag:
                if list_tag:
                    output.append(f"</{list_tag}>")
                if tag:
                    start = _integer(item.get("props", {}).get("start"))
                    output.append(f'<{tag} start="{start}">' if tag == "ol" else "<ul>")
                list_tag = tag
            output.append(self.block(item, legacy, (*prefix, index)))
        if list_tag:
            output.append(f"</{list_tag}>")
        return "".join(output)

    def block(self, item: dict, legacy: bool, path: tuple[int, ...]) -> str:
        kind = item.get("type")
        props = item.get("attrs" if legacy else "props") or {}
        content = self.inline(item.get("content"))
        if kind == "heading" and not (
            path == (0,) and _text(item.get("content")).strip() == self.title.strip()
        ):
            self.outline.append(
                ("heading-" + "-".join(map(str, path)), _text(item.get("content")))
            )
        child_values = item.get("content" if legacy else "children", [])
        # Inline legacy nodes are rendered only once by their containing block.
        children = (
            self.nodes(child_values, legacy, path)
            if isinstance(child_values, list)
            and (
                not legacy or kind not in {"paragraph", "heading", "codeBlock", "text"}
            )
            and kind != "steps"
            else ""
        )
        if kind == "steps":
            children = "".join(
                "<li>" + self.block(child, False, (*path, index)) + "</li>"
                for index, child in enumerate(child_values)
            )
        suffix = "" if legacy else children
        if kind == "text":
            return self.inline(item)
        if kind == "heading":
            if (
                path == (0,)
                and _text(item.get("content")).strip() == self.title.strip()
            ):
                return suffix
            anchor = "heading-" + "-".join(map(str, path))
            level = _integer(props.get("level"), 2, 1, 6)
            return f'<h{level} id="{anchor}">{content}</h{level}>' + suffix
        if kind == "paragraph":
            return f"<p>{content}</p>" + suffix
        if kind == "codeBlock":
            language = escape(str(props.get("language") or "text"))
            return (
                f'<div class="content-code-block"><div class="content-code-toolbar"><span>{language}</span></div><pre><code>{escape(_text(item.get("content")))}</code></pre></div>'
                + suffix
            )
        if kind in {"divider", "horizontalRule"}:
            return "<hr>" + suffix
        if kind in {"quote", "blockquote"}:
            return (
                "<blockquote>"
                + (content if kind == "quote" else "")
                + children
                + "</blockquote>"
            )
        tags = {
            "bulletList": "ul",
            "orderedList": "ol",
            "taskList": "ul",
            "listItem": "li",
            "tableRow": "tr",
            "tableCell": "td",
            "tableHeader": "th",
        }
        if kind in tags:
            tag = tags[kind]
            extra = (
                f' start="{_integer(props.get("start"))}"'
                if kind == "orderedList"
                else ""
            )
            return f"<{tag}{extra}>{children}</{tag}>"
        if kind in {"bulletListItem", "numberedListItem", "checkListItem", "taskItem"}:
            checked = (
                '<input type="checkbox" disabled aria-label="待办事项"'
                + (" checked" if props.get("checked") else "")
                + ">"
                if kind in {"checkListItem", "taskItem"}
                else ""
            )
            start = (
                f' value="{_integer(props["start"])}"'
                if kind == "numberedListItem" and "start" in props
                else ""
            )
            return (
                f"<li{start}>"
                + checked
                + ("" if legacy else content)
                + children
                + "</li>"
            )
        if kind == "toggleListItem":
            return f"<details open><summary>{content}</summary>{children}</details>"
        if kind == "table":
            if not legacy:
                table = item.get("content", {})
                rows = (
                    table.get("rows", [])
                    if isinstance(table, dict)
                    else [{"cells": row} for row in table if isinstance(row, list)]
                )
                header_rows = (
                    _integer(table.get("headerRows"), 0, 0)
                    if isinstance(table, dict)
                    else 0
                )
                header_cols = (
                    _integer(table.get("headerCols"), 0, 0)
                    if isinstance(table, dict)
                    else 0
                )
                rendered = []
                for row_index, row in enumerate(rows):
                    cells = []
                    for col_index, cell in enumerate(row.get("cells", [])):
                        tag = (
                            "th"
                            if row_index < header_rows or col_index < header_cols
                            else "td"
                        )
                        cell_props = (
                            cell.get("props", {}) if isinstance(cell, dict) else {}
                        )
                        spans = "".join(
                            f' {key}="{_integer(cell_props[key])}"'
                            for key in ("colspan", "rowspan")
                            if key in cell_props
                        )
                        cells.append(
                            f"<{tag}{spans}>"
                            + self.inline(
                                cell.get("content", [])
                                if isinstance(cell, dict)
                                else cell
                            )
                            + f"</{tag}>"
                        )
                    rendered.append("<tr>" + "".join(cells) + "</tr>")
                table_body = "".join(rendered)
            else:
                table_body = children
            return (
                '<div class="content-table-scroll"><table><tbody>'
                + table_body
                + "</tbody></table></div>"
                + suffix
            )
        if kind in {"image", "file", "audio", "video"}:
            url = public_url(props.get("url"), self.base, media=True)
            label = escape(str(props.get("caption") or props.get("name") or kind))
            if not url:
                return f"<p>{label}</p>" + suffix
            src = escape(url, quote=True)
            media = (
                f'<img src="{src}" alt="{label}" loading="lazy">'
                if kind == "image"
                else f'<{kind} src="{src}" controls preload="metadata"></{kind}>'
                if kind in {"audio", "video"}
                else f'<a href="{src}">{label}</a>'
            )
            return f"<figure>{media}<figcaption>{label}</figcaption></figure>" + suffix
        title = escape(str(props.get("title") or ""))
        if kind == "card":
            return (
                '<section class="doc-card">'
                + self.link(props.get("href"), f"<h3>{title}</h3>")
                + content
                + children
                + "</section>"
            )
        if kind == "callout":
            tone = (
                props.get("tone")
                if props.get("tone")
                in {"info", "success", "warning", "danger", "note", "tip"}
                else "info"
            )
            return f'<aside class="doc-callout doc-callout-{tone}"><strong>{title}</strong><p>{content}</p>{children}</aside>'
        if kind in {"cardGroup", "steps", "tabs", "codeGroup", "step", "tab"}:
            classes = {
                "cardGroup": "doc-card-grid",
                "steps": "doc-steps",
                "tabs": "doc-tabs",
                "codeGroup": "doc-code-group",
                "step": "doc-step",
                "tab": "doc-tab-panel",
            }
            heading = f"<h3>{title}</h3>" if title else ""
            if kind == "steps":
                return f'<ol class="doc-steps" aria-label="步骤">{children}</ol>'
            return f'<section class="{classes[kind]}">{heading}{content}{children}</section>'
        return f"<div>{content}{suffix}</div>"


def render_site(
    snapshot: SiteSnapshotOut, page: SitePageOut, base: str, dist: Path
) -> str:
    renderer = DocumentHtml(base, page.title)
    legacy = page.blocks.get("schema_version") != 2
    roots = (
        page.blocks.get("doc", {}).get("content", [])
        if legacy
        else page.blocks.get("blocks", [])
    )
    body = renderer.nodes(roots, legacy)
    canonical = base + site_path(snapshot.slug, page.slug)
    description = page.description or snapshot.description
    title = page.title + " · " + snapshot.name
    nav = "".join(
        '<li class="site-reader-navigation-item">'
        + f'<a href="{escape(site_path(snapshot.slug, item.slug))}"'
        + (' aria-current="page"' if item.slug == page.slug else "")
        + f">{escape(item.title)}</a></li>"
        for item in snapshot.pages
    )
    outline = "".join(
        f'<li><a href="#{anchor}">{escape(text)}</a></li>'
        for anchor, text in renderer.outline
    )
    branding = snapshot.branding
    header_links = "".join(
        renderer.link(link.url, escape(link.label)) for link in branding.links
    )
    footer_links = "".join(
        renderer.link(link.url, escape(link.label)) for link in branding.footer_links
    )
    if branding.cta:
        header_links += renderer.link(branding.cta.url, escape(branding.cta.label))
    logo = public_url(branding.logo_url, base, media=True)
    logo_html = (
        f'<img src="{escape(logo, quote=True)}" alt="" width="28" height="28">'
        if logo
        else ""
    )
    markdown = (
        site_path(snapshot.slug) + "/pages/" + "/".join(page.slug.split("/")) + ".md"
    )
    bootstrap = json.dumps(
        {
            "manifest": manifest(snapshot, base + site_path(snapshot.slug)).model_dump(
                mode="json"
            ),
            "page": page_delivery(snapshot, page.slug).model_dump(mode="json"),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    for char, replacement in (
        ("&", "\\u0026"),
        ("<", "\\u003c"),
        (">", "\\u003e"),
        ("\u2028", "\\u2028"),
        ("\u2029", "\\u2029"),
    ):
        bootstrap = bootstrap.replace(char, replacement)
    bundle = reader_bundle(dist)
    theme = "dark" if branding.theme == "dark" else "light"
    accent = (
        snapshot.accent_color
        if re.fullmatch(r"#[0-9a-fA-F]{6}", snapshot.accent_color)
        else "#0f766e"
    )
    # This scoped fallback also makes small-screen navigation usable without JS.
    fallback = "<style>.site-reader-ssr{font:16px/1.7 system-ui,sans-serif;color:var(--reading-text,#17202a);background:var(--reading-bg,#fff);min-height:100vh}.site-reader-ssr a{color:#0f766e}.site-reader-ssr .site-reader-header-inner{display:flex;gap:2rem;align-items:center;padding:1rem 2rem}.site-reader-ssr .site-reader-layout{display:grid;grid-template-columns:240px minmax(0,760px) 200px;gap:2rem;max-width:1320px;margin:auto;padding:2rem}.site-reader-ssr .site-reader-content{min-width:0}.site-reader-ssr pre{overflow:auto;background:#f5f7f8;padding:1rem}.site-reader-ssr img,.site-reader-ssr video{max-width:100%}.site-reader-ssr .site-reader-navigation,.site-reader-ssr .site-reader-outline{display:block;position:static;transform:none}.site-reader-ssr .site-reader-navigation ul{list-style:none;padding:0}.site-reader-ssr table{border-collapse:collapse}.site-reader-ssr td,.site-reader-ssr th{border:1px solid #dce3e8;padding:.5rem}.site-reader-ssr .site-reader-navigation-item a{display:block;padding:.3rem}.site-reader-ssr .doc-tab-panel{display:block}.site-reader-ssr .site-reader-navigation-footer{position:static}@media(max-width:800px){.site-reader-ssr .site-reader-layout{grid-template-columns:1fr;padding:1rem}.site-reader-ssr .site-reader-navigation{width:auto;max-height:none;visibility:visible}.site-reader-ssr .site-reader-header-inner{flex-wrap:wrap}}</style>"
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title><meta name="description" content="{escape(description, quote=True)}"><link rel="canonical" href="{escape(canonical, quote=True)}"><meta property="og:title" content="{escape(title, quote=True)}"><meta property="og:description" content="{escape(description, quote=True)}"><meta property="og:url" content="{escape(canonical, quote=True)}"><meta property="og:type" content="article"><meta name="robots" content="index, follow"><link rel="sitemap" type="application/xml" href="{site_path(snapshot.slug)}/sitemap.xml"><link rel="alternate" type="text/markdown" href="{markdown}"><link rel="describedby" href="{site_path(snapshot.slug)}/llms.txt">{bundle}{fallback}</head><body><div id="root"><div class="site-reader site-reader-ssr" data-theme="{theme}" style="--site-accent:{accent}"><a class="site-reader-skip-link" href="#site-content">跳转到正文</a><header class="site-reader-header"><div class="site-reader-header-inner"><a class="site-reader-brand" href="{site_path(snapshot.slug)}">{logo_html}{escape(snapshot.name)}</a>{header_links}</div></header><div class="site-reader-layout"><aside class="site-reader-navigation"><p class="site-reader-navigation-intro">{escape(snapshot.description)}</p><nav aria-label="站点导航"><ul>{nav}</ul></nav><footer class="site-reader-navigation-footer">{footer_links}<span>由 Orbis 提供支持</span></footer></aside><main id="site-content" class="site-reader-content"><div class="site-reader-title-row"><div><h1>{escape(page.title)}</h1><p>{escape(page.description)}</p></div><a href="{markdown}">Markdown</a></div><article class="document-prose">{body}</article></main><aside class="site-reader-outline"><span>本页目录</span><nav aria-label="本页目录"><ul>{outline}</ul></nav></aside></div></div></div><script id="orbis-site-bootstrap" type="application/json">{bootstrap}</script></body></html>'''


def error_html(message: str) -> str:
    return f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>页面不存在 · Orbis</title><meta name="robots" content="noindex, nofollow"></head><body><main><h1>页面不存在</h1><p>{escape(message)}</p></main></body></html>'
