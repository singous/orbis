from __future__ import annotations

from copy import deepcopy

import pytest
from orbis_user_api.application.site_content import public_note_blocks
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
