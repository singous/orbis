from __future__ import annotations

import json
import re
from xml.etree import ElementTree

import pytest


def block(kind, text="", props=None, children=None):
    return {
        "id": f"private-{kind}",
        "type": kind,
        "props": props or {},
        "content": [{"type": "text", "text": text}] if text else [],
        "children": children or [],
    }


@pytest.fixture()
def published(client, owner, document, tmp_path):
    client.app.state.settings.user_web_base_url = "https://docs.example.com"
    object.__setattr__(
        client.app.state.settings, "user_web_dist_dir", tmp_path / "absent-dist"
    )
    blocks = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            block("heading", "安装 & 使用", {"level": 2}),
            block("paragraph", "Literal </script><script>alert(1)</script> & 正文"),
            block(
                "tabs",
                children=[
                    block(
                        "tab",
                        props={"title": "Linux"},
                        children=[block("paragraph", "Linux 正文")],
                    ),
                    block(
                        "tab",
                        props={"title": "macOS"},
                        children=[block("paragraph", "macOS 正文")],
                    ),
                ],
            ),
            block(
                "codeGroup",
                children=[
                    block("codeBlock", 'print("<safe>")', {"language": "python"}),
                    block("codeBlock", "echo hello", {"language": "bash"}),
                ],
            ),
            block(
                "card", props={"title": "外部入口", "href": "https://example.com/a)"}
            ),
        ],
    }
    saved = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={"expected_version": 1, "blocks": blocks},
    )
    assert saved.status_code == 200, saved.text
    second = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": document["notebook_id"], "title": "second"},
    ).json()["data"]
    saved = client.put(
        f"/notes/{second['id']}/content",
        headers=owner,
        json={
            "expected_version": 1,
            "blocks": {
                "schema_version": 1,
                "editor": "tiptap",
                "doc": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "SECOND_BODY_ONLY"}],
                        }
                    ],
                },
            },
        },
    )
    assert saved.status_code == 200, saved.text
    site = client.post(
        "/sites",
        headers=owner,
        json={
            "name": "文档 & <站点>",
            "slug": "exports",
            "description": '描述 <安全> & "双引号"',
            "navigation": [
                {"note_id": document["id"], "slug": "start", "title": "开始 <阅读>"},
                {"note_id": second["id"], "slug": "second", "title": "Second"},
            ],
        },
    ).json()["data"]
    release = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert release.status_code == 200, release.text
    return site, release.json()["data"], document


def test_split_delivery_omits_other_bodies_and_pins_active_release(client, published):
    _, snapshot, document = published
    manifest = client.get("/public/sites/exports/manifest")
    assert manifest.status_code == 200, manifest.text
    assert manifest.headers["cache-control"] == "no-store"
    data = manifest.json()["data"]
    assert data["canonical_base_url"] == "https://docs.example.com/s/exports"
    assert data["release_id"] == snapshot["release_id"]
    assert set(data["pages"][0]) == {
        "slug",
        "title",
        "group",
        "parent_slug",
        "section",
        "description",
        "updated_at_ms",
    }
    page = client.get(
        "/public/sites/exports/pages/start",
        params={"expected_release_id": data["release_id"]},
    )
    assert page.json()["data"] == {
        "release_id": data["release_id"],
        "page": snapshot["pages"][0],
    }
    assert "SECOND_BODY_ONLY" not in page.text
    search = client.get("/public/sites/exports/search").json()["data"]
    assert search["release_id"] == data["release_id"]
    assert "blocks" not in search["pages"][0]
    assert "macOS 正文" in search["pages"][0]["plain_text"]
    for output in (data, page.json(), search):
        assert document["id"] not in json.dumps(output)
        assert "private-" not in json.dumps(output)
    for path in (
        "/public/sites/exports/pages/start",
        "/public/sites/exports/search",
        "/s/exports/llms.txt",
    ):
        conflict = client.get(
            path, params={"expected_release_id": "00000000-0000-4000-8000-000000000001"}
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "SITE_RELEASE_CHANGED"
        assert conflict.headers["cache-control"] == "no-store"


def test_initial_html_is_literal_canonical_and_only_bootstraps_selected_body(
    client, published
):
    _, release, document = published
    response = client.get("/s/exports", headers={"host": "attacker.example"})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/html")
    html = response.text
    assert "<h1>开始 &lt;阅读&gt;</h1>" in html
    assert "<title>开始 &lt;阅读&gt; · 文档 &amp; &lt;站点&gt;</title>" in html
    assert (
        'name="description" content="描述 &lt;安全&gt; &amp; &quot;双引号&quot;"'
        in html
    )
    assert 'rel="canonical" href="https://docs.example.com/s/exports/start"' in html
    assert (
        'property="og:url" content="https://docs.example.com/s/exports/start"' in html
    )
    assert 'name="robots" content="index, follow"' in html
    assert "attacker.example" not in html
    assert "<script>alert(1)</script>" not in html
    assert "Literal &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "Linux 正文" in html and "macOS 正文" in html
    assert "site-reader-layout" in html and "site-reader-outline" in html
    assert "SECOND_BODY_ONLY" not in html
    assert document["id"] not in html and "private-heading" not in html
    bootstrap = re.search(
        r'<script id="orbis-site-bootstrap" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert bootstrap
    data = json.loads(bootstrap.group(1))
    assert data["page"] == {
        "release_id": release["release_id"],
        "page": release["pages"][0],
    }
    assert "blocks" not in data["manifest"]["pages"][0]
    assert '<script type="module"' not in html
    for path in ("/s/exports/missing", "/s/absent", "/s/exports/not-real.xml"):
        missing = client.get(path)
        assert missing.status_code == 404
        assert missing.headers["content-type"].startswith("text/html")


def test_machine_exports_are_complete_and_use_canonical_urls(client, published):
    _, release, _ = published
    sitemap = client.get("/s/exports/sitemap.xml")
    assert sitemap.status_code == 200, sitemap.text
    xml = ElementTree.fromstring(sitemap.text)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    assert [x.text for x in xml.findall("s:url/s:loc", ns)] == [
        "https://docs.example.com/s/exports/start",
        "https://docs.example.com/s/exports/second",
    ]
    assert xml.findall("s:url/s:lastmod", ns)
    robots = client.get("/s/exports/robots.txt")
    assert "Sitemap: https://docs.example.com/s/exports/sitemap.xml" in robots.text
    llms = client.get("/s/exports/llms.txt")
    assert "https://docs.example.com/s/exports/pages/start.md" in llms.text
    markdown = client.get("/s/exports/pages/start.md")
    assert markdown.status_code == 200, markdown.text
    assert "### [外部入口](https://example.com/a\\))" in markdown.text
    for value in ("Linux 正文", "macOS 正文", 'print("<safe>")', "echo hello"):
        assert value in markdown.text
    full = client.get("/s/exports/llms-full.txt")
    assert markdown.text.strip() in full.text and "SECOND_BODY_ONLY" in full.text
    for response in (sitemap, robots, llms, markdown, full):
        assert response.headers["cache-control"] == "no-store"
    assert client.get("/public/sites/exports").json()["data"] == release


def test_republish_rollback_and_withdraw_control_every_delivery(
    client, owner, published
):
    site, first, document = published
    saved = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={
            "expected_version": 2,
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": [block("paragraph", "NEW_RELEASE_TEXT")],
            },
        },
    )
    assert saved.status_code == 200
    second = client.post(f"/sites/{site['id']}/publish", headers=owner).json()["data"]
    assert second["release_id"] != first["release_id"]
    paths = [
        "/s/exports/start",
        "/s/exports/pages/start.md",
        "/s/exports/llms-full.txt",
        "/public/sites/exports/pages/start",
        "/public/sites/exports/search",
    ]
    for path in paths:
        assert "NEW_RELEASE_TEXT" in client.get(path).text
    assert (
        client.get(
            "/public/sites/exports/search",
            params={"expected_release_id": first["release_id"]},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/sites/{site['id']}/releases/{first['release_id']}/activate",
            headers=owner,
        ).status_code
        == 200
    )
    for path in paths:
        assert "NEW_RELEASE_TEXT" not in client.get(path).text
    assert (
        client.post(f"/sites/{site['id']}/unpublish", headers=owner).status_code == 200
    )
    for path in [
        *paths,
        "/public/sites/exports/manifest",
        "/s/exports",
        "/s/exports/sitemap.xml",
        "/s/exports/robots.txt",
        "/s/exports/llms.txt",
    ]:
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.headers["cache-control"] == "no-store", path


def test_vite_manifest_loads_only_reader_css_and_safe_built_assets(
    client, published, tmp_path
):
    dist = tmp_path / "dist"
    (dist / ".vite").mkdir(parents=True)
    (dist / "assets").mkdir()
    for name in (
        "main-abc123.js",
        "global-def456.css",
        "reader-abc123.css",
        "prose-abc123.css",
        "shared-abc123.css",
        "editor-abc123.css",
    ):
        (dist / "assets" / name).write_text("/* built */")
    (dist / ".vite" / "manifest.json").write_text(
        json.dumps(
            {
                "index.html": {
                    "file": "assets/main-abc123.js",
                    "isEntry": True,
                    "css": ["assets/global-def456.css"],
                    "dynamicImports": [
                        "src/features/sites/PublicSitePage.tsx",
                        "Editor.tsx",
                    ],
                },
                "src/features/sites/PublicSitePage.tsx": {
                    "file": "assets/reader-abc123.js",
                    "css": ["assets/reader-abc123.css"],
                    "imports": ["ContentRenderer.tsx"],
                },
                "ContentRenderer.tsx": {
                    "file": "assets/prose-abc123.js",
                    "css": ["assets/prose-abc123.css"],
                    "imports": ["shared"],
                },
                "shared": {
                    "file": "assets/shared-abc123.js",
                    "css": ["assets/shared-abc123.css"],
                },
                "Editor.tsx": {
                    "file": "assets/editor-abc123.js",
                    "css": ["assets/editor-abc123.css"],
                },
            }
        )
    )
    client.app.state.settings.user_web_dist_dir = dist
    html = client.get("/s/exports/start").text
    for name in (
        "main-abc123.js",
        "global-def456.css",
        "reader-abc123.css",
        "prose-abc123.css",
        "shared-abc123.css",
    ):
        assert "/assets/" + name in html
    assert "editor-abc123" not in html
    assert client.get("/assets/main-abc123.js").text == "/* built */"
    (dist / "secret.txt").write_text("secret")
    (dist / "assets" / "escape-abc123.js").symlink_to(dist / "secret.txt")
    for path in (
        "/assets/%2e%2e/secret.txt",
        "/assets/escape-abc123.js",
        "/assets/manifest.json",
    ):
        assert client.get(path).status_code == 404


def test_markdown_destination_formatter_preserves_delimiters():
    from orbis_user_api.domain.note_content import blocks_to_markdown

    destination = "https://example.com/a)b(c\\d e<z>\n"
    document = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [block("card", props={"title": "Link", "href": destination})],
    }
    assert (
        blocks_to_markdown(document)
        == "### [Link](https://example.com/a\\)b\\(c\\\\d%20e%3Cz%3E%0A)"
    )


def test_nested_slugs_aliases_and_encoded_slashes_follow_active_registry(
    client, owner, published
):
    site, first, document = published
    config = {
        key: site[key]
        for key in (
            "name",
            "slug",
            "description",
            "site_kind",
            "accent_color",
            "branding",
        )
    }
    config["source"] = {
        "kind": "notebooks",
        "notebooks": [{"notebook_id": document["notebook_id"]}],
        "page_overrides": [{"note_id": document["id"], "slug": "guides/start"}],
    }
    update = client.put(
        f"/sites/{site['id']}",
        headers=owner,
        json={**config, "expected_version": site["config_version"]},
    )
    assert update.status_code == 200, update.text
    preview = client.get(f"/sites/{site['id']}/preview", headers=owner).json()["data"]
    publish = client.post(
        f"/sites/{site['id']}/publish",
        headers=owner,
        json={"expected_source_fingerprint": preview["source_fingerprint"]},
    )
    assert publish.status_code == 200, publish.text
    assert publish.json()["data"]["redirects"]["start"] == "guides/start"
    response = client.get(
        "/s/exports/start?redirect=https://evil.example",
        headers={"host": "evil.example"},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"] == "/s/exports/guides/start"
    assert response.headers["cache-control"] == "no-store"
    for path in (
        "/s/exports/guides/start",
        "/s/exports/guides%2Fstart",
        "/public/sites/exports/pages/guides%2Fstart",
        "/s/exports/pages/guides%2Fstart.md",
    ):
        assert client.get(path).status_code == 200, path
    for path in (
        "/s/exports/guides%252Fstart",
        "/s/exports/%2e%2e/start",
        "/s/exports//evil.example",
        "/public/sites/exports/pages/guides/start.xml",
    ):
        assert client.get(path).status_code == 404, path
    assert (
        client.post(
            f"/sites/{site['id']}/releases/{first['release_id']}/activate",
            headers=owner,
        ).status_code
        == 200
    )
    assert client.get("/s/exports/start", follow_redirects=False).status_code == 200
    assert client.get("/s/exports/guides/start").status_code == 404


def test_markdown_preserves_media_quotes_and_code_without_rewriting_literal_text():
    from orbis_user_api.application.site_exports import page_markdown
    from orbis_user_api.schemas.site import SitePageOut

    url = "/public/sites/exports/assets/" + "a" * 64
    blocks = [
        block("image", props={"url": url, "caption": "截图"}),
        block("quote", "quote parent", children=[block("paragraph", "quote child")]),
        block("codeBlock", "/s/exports/start", {"language": "text"}),
    ]
    blocks[-1]["content"][0]["styles"] = {"bold": True}
    page = SitePageOut(
        slug="start",
        title="Title",
        group=None,
        plain_text="",
        blocks={"schema_version": 2, "editor": "blocknote", "blocks": blocks},
    )
    markdown = page_markdown(page, "https://docs.example.com")
    assert "![截图](https://docs.example.com" + url + ")" in markdown
    assert "> quote parent" in markdown and "> quote child" in markdown
    assert "```text\n/s/exports/start\n```" in markdown


def test_html_nested_headings_preserve_outline_order_and_safe_components():
    from orbis_user_api.application.site_html import DocumentHtml

    values = [
        block(
            "heading", "Parent", {"level": 2}, [block("heading", "Child", {"level": 3})]
        ),
        block(
            "steps",
            children=[
                block(
                    "step",
                    props={"title": "Step"},
                    children=[block("paragraph", "正文")],
                )
            ],
        ),
        block(
            "cardGroup",
            props={"columns": 3},
            children=[
                block("card", props={"title": "Card", "href": "javascript:alert(1)"})
            ],
        ),
        block(
            "image",
            props={
                "url": "data:text/html,<script>alert(1)</script>",
                "caption": "<unsafe>",
            },
        ),
    ]
    renderer = DocumentHtml("https://docs.example.com", "Title")
    html = renderer.nodes(values, False)
    assert renderer.outline == [("heading-0", "Parent"), ("heading-0-0", "Child")]
    assert '<ol class="doc-steps"' in html and '<li><section class="doc-step">' in html
    assert 'class="doc-card-grid"' in html
    assert "javascript:" not in html and "data:text/html" not in html
    assert "&lt;unsafe&gt;" in html


@pytest.mark.parametrize(
    "url",
    [
        "https://exa<mple.com",
        "https://example.com:bad",
        "javascript:alert(1)",
        "//evil.example",
        "https://user:pass@example.com",
        "https://example.com?x=1",
        "https://example.com/#fragment",
        "https://example.com\\@evil.example",
        "https://example.com\n",
    ],
)
def test_canonical_configuration_rejects_unsafe_urls(url):
    from orbis_user_api.application.site_exports import canonical_base

    with pytest.raises(ValueError):
        canonical_base(url)


def test_site_delivery_openapi_documents_json_and_explicit_text_exceptions(client):
    schema = client.app.openapi()
    paths = {
        "/public/sites/{slug}/manifest": "application/json",
        "/public/sites/{slug}/pages/{page_slug}": "application/json",
        "/public/sites/{slug}/search": "application/json",
        "/s/{slug}/sitemap.xml": "application/xml",
        "/s/{slug}/robots.txt": "text/plain",
        "/s/{slug}/llms.txt": "text/plain",
        "/s/{slug}/llms-full.txt": "text/plain",
        "/s/{slug}/pages/{page_slug}.md": "text/markdown",
    }
    for path, content_type in paths.items():
        operation = schema["paths"][path]["get"]
        assert not operation.get("security")
        assert "匿名" in operation["description"]
        assert "响应格式" in operation["description"]
        assert operation["responses"]["200"]["content"].keys() == {content_type}
        conflict = operation["responses"]["409"]["content"]["application/json"][
            "examples"
        ]
        assert (
            conflict["SITE_RELEASE_CHANGED"]["value"]["code"] == "SITE_RELEASE_CHANGED"
        )
        assert (
            "SITE_NOT_FOUND"
            in operation["responses"]["404"]["content"]["application/json"]["examples"]
        )
    assert "/s/{slug}/{page_slug}" not in schema["paths"]


@pytest.mark.parametrize("legacy", [False, True])
def test_markdown_code_fences_preserve_embedded_fences_and_reject_info_injection(
    legacy,
):
    from orbis_user_api.domain.note_content import blocks_to_markdown

    source = "```python\nprint(1)\n```\n````"
    blocks = (
        {
            "schema_version": 1,
            "editor": "tiptap",
            "doc": {
                "type": "doc",
                "content": [
                    {
                        "type": "codeBlock",
                        "attrs": {"language": "markdown\n```injected"},
                        "content": [{"type": "text", "text": source}],
                    }
                ],
            },
        }
        if legacy
        else {
            "schema_version": 2,
            "editor": "blocknote",
            "blocks": [
                block("codeBlock", source, {"language": "markdown\n```injected"})
            ],
        }
    )
    assert blocks_to_markdown(blocks) == "`````markdowninjected\n" + source + "\n`````"


def test_invalid_release_guard_is_not_cacheable_and_never_fetches_urls(
    client, published
):
    response = client.get(
        "/public/sites/exports/search",
        params={"expected_release_id": "https://example.com/data"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.headers["cache-control"] == "no-store"


def test_markdown_keeps_nested_content_after_heading_code_and_divider():
    from orbis_user_api.domain.note_content import blocks_to_markdown

    values = [
        block(kind, text, props, [block("paragraph", "nested-" + kind)])
        for kind, text, props in (
            ("heading", "Title", {"level": 2}),
            ("codeBlock", "code()", {"language": "python"}),
            ("divider", "", {}),
        )
    ]
    markdown = blocks_to_markdown(
        {"schema_version": 2, "editor": "blocknote", "blocks": values}
    )
    for kind in ("heading", "codeBlock", "divider"):
        assert "nested-" + kind in markdown


def test_html_distinguishes_missing_pages_from_unpublished_sites(
    client, owner, published
):
    site, _, _ = published
    missing_page = client.get("/s/exports/missing")
    unknown_site = client.get("/s/unknown-site")
    assert (
        client.post(f"/sites/{site['id']}/unpublish", headers=owner).status_code == 200
    )
    withdrawn_site = client.get("/s/exports/start")
    for response, title in (
        (missing_page, "页面不存在"),
        (unknown_site, "站点尚未发布或已撤回"),
        (withdrawn_site, "站点尚未发布或已撤回"),
    ):
        assert response.status_code == 404
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-robots-tag"] == "noindex, nofollow"
        assert '<meta name="robots" content="noindex, nofollow">' in response.text
        assert f"<h1>{title}</h1>" in response.text
        assert f"<title>{title} · Orbis</title>" in response.text
