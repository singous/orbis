from __future__ import annotations

from copy import deepcopy

import pytest
from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_html import DocumentHtml
from orbis_user_api.application.site_errors import SiteError
from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    blocks_to_markdown,
    derive_plain_text,
    normalize_note_blocks,
)


def block(kind, *, props=None, text="", children=None):
    return {
        "id": f"internal-{kind}",
        "type": kind,
        "props": props or {},
        "content": [{"type": "text", "text": text}] if text else [],
        "children": children or [],
    }


def document(*items):
    return {"schema_version": 2, "editor": "blocknote", "blocks": list(items)}


def test_document_components_validate_and_export_all_authored_content():
    value = document(
        block("callout", props={"title": "注意事项", "tone": "warning"}, text="先备份"),
        block(
            "cardGroup",
            props={"columns": 2},
            children=[
                block(
                    "card",
                    props={"title": "快速开始", "href": "https://example.com/start"},
                    children=[block("paragraph", text="安装与配置")],
                )
            ],
        ),
        block(
            "steps",
            children=[
                block(
                    "step",
                    props={"title": "安装"},
                    children=[
                        block(
                            "codeBlock",
                            props={"language": "bash"},
                            text="npm install orbis",
                        )
                    ],
                )
            ],
        ),
        block(
            "tabs",
            children=[
                block(
                    "tab",
                    props={"title": "Linux"},
                    children=[block("paragraph", text="Linux 配置说明")],
                ),
                block(
                    "tab",
                    props={"title": "macOS"},
                    children=[block("paragraph", text="Mac 配置说明")],
                ),
            ],
        ),
        block(
            "codeGroup",
            children=[
                block("codeBlock", props={"language": "python"}, text="print('Orbis')"),
                block(
                    "codeBlock",
                    props={"language": "javascript"},
                    text="console.log('Orbis')",
                ),
            ],
        ),
    )
    original = deepcopy(value)
    normalized = normalize_note_blocks(value)
    assert value == original
    plain = derive_plain_text(normalized)
    markdown = blocks_to_markdown(normalized)
    for text in [
        "注意事项",
        "先备份",
        "快速开始",
        "安装与配置",
        "安装",
        "Linux",
        "Linux 配置说明",
        "macOS",
        "Mac 配置说明",
        "print('Orbis')",
        "console.log('Orbis')",
    ]:
        assert text in plain
        assert text in markdown
    assert "https://example.com/start" in markdown
    assert "```python" in markdown and "```javascript" in markdown
    assert "1. **安装**" in markdown


def test_public_components_project_known_properties_without_private_metadata():
    value = document(
        block(
            "card",
            props={
                "title": "安装",
                "href": "https://example.com/install",
                "author_id": "private-owner",
                "token": "private-token",
            },
            children=[block("paragraph", text="公开说明")],
        )
    )
    public = public_note_blocks(value)
    props = public["blocks"][0]["props"]
    assert props["title"] == "安装" and props["href"] == "https://example.com/install"
    assert "author_id" not in props and "token" not in props
    assert public["blocks"][0]["id"] == "public-0"
    assert public_note_blocks(public) == public


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "https://example.com/file?token=private",
        "http://127.0.0.1/private",
    ],
)
def test_card_links_follow_the_public_url_boundary(href):
    with pytest.raises(SiteError) as error:
        public_note_blocks(
            document(block("card", props={"title": "Unsafe", "href": href}))
        )
    assert error.value.code == "SITE_CONTENT_UNSAFE"


@pytest.mark.parametrize(
    "item",
    [
        block("callout", props={"tone": "execute"}),
        block("cardGroup", props={"columns": 99}),
        block("card", props={"title": ["invalid"]}),
        block("tabs", children=[block("paragraph", text="Outside a tab")]),
        block("codeGroup", children=[block("image")]),
        block("card", text="Hidden inline text"),
    ],
)
def test_invalid_component_shapes_are_rejected_without_silent_content_loss(item):
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(item))


def test_normalization_supplies_component_defaults_without_mutating_input():
    value = document(block("callout", text="提示"))
    normalized = normalize_note_blocks(value)
    assert normalized["blocks"][0]["props"]["tone"] == "info"
    assert value["blocks"][0]["props"] == {}


def test_public_projection_skips_only_empty_media_placeholders_without_changing_saved_blocks():
    empty = block("image", props={"url": "", "name": ""})
    value = document(block("paragraph", text="保留正文"), empty)
    original = deepcopy(value)
    public = public_note_blocks(value)
    assert [item["type"] for item in public["blocks"]] == ["paragraph"]
    assert value == original
    with pytest.raises(SiteError):
        public_note_blocks(document(block("image", props={"url": "", "name": "有名称的附件"})))


def test_static_public_html_keeps_supported_inline_colors_and_alignment():
    renderer = DocumentHtml("https://example.com", "公开文档")
    value = block("paragraph", props={"textAlignment": "center"})
    value["content"] = [{"type": "text", "text": "强调", "styles": {"bold": True, "textColor": "#aabbcc"}}]
    html = renderer.block(value, False, (0,))
    assert '<p style="text-align: center">' in html
    assert '<span style="color: #aabbcc"><strong>强调</strong></span>' in html
    table = {"type": "table", "props": {}, "content": {"type": "tableContent", "headerRows": 1, "rows": [{"cells": [{"type": "tableCell", "props": {"backgroundColor": "#f1faf4", "textAlignment": "center"}, "content": "兼容性"}]}]}, "children": []}
    assert '<th style="background-color: #f1faf4; text-align: center">兼容性</th>' in renderer.block(table, False, (1,))


def test_transparent_groups_preserve_nested_content_and_export_without_chrome():
    first = block("paragraph", text="First")
    first["id"] = "first"
    heading = block("heading", props={"level": 2}, text="Heading")
    heading["id"] = "heading"
    last = block("paragraph", text="Last")
    last["id"] = "last"
    nested = block("group", children=[heading, last])
    nested["id"] = "nested"
    value = document(block("group", children=[first, nested]))
    normalized = normalize_note_blocks(value)
    assert normalized == value
    assert normalize_note_blocks(normalized) == normalized
    assert derive_plain_text(normalized) == "First\nHeading\nLast"
    assert blocks_to_markdown(normalized) == blocks_to_markdown(document(first, heading, last))
    public = public_note_blocks(normalized)
    assert public["blocks"][0]["type"] == "group"
    assert public["blocks"][0]["children"][1]["type"] == "group"
    html = DocumentHtml("https://example.com", "Public").nodes(public["blocks"], False)
    assert '<h2 id="heading-0-1-0"' in html
    assert "<section" not in html and "<div" not in html
    assert html.index("First") < html.index("Heading") < html.index("Last")


def test_transparent_group_rejects_hidden_inline_content():
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(block("group", text="Hidden")))
