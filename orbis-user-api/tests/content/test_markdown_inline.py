from __future__ import annotations

import pytest

from orbis_user_api.domain.markdown_inline import parse_inline, render_text
from orbis_user_api.domain.note_content import (
    blocks_to_markdown,
    derive_plain_text,
    markdown_to_blocks,
)


def semantic_inline(nodes):
    result = []
    for node in nodes:
        marks = frozenset(
            (mark["type"], mark.get("attrs", {}).get("href"))
            for mark in node.get("marks", [])
        )
        for character in node["text"]:
            result.append((character, marks))
    return result


def paragraph(nodes):
    return {
        "schema_version": 1,
        "editor": "tiptap",
        "doc": {"type": "doc", "content": [{"type": "paragraph", "content": nodes}]},
    }


def test_import_parses_emphasis_code_strike_and_nested_link_marks():
    imported = markdown_to_blocks(
        "**粗体** *斜体* ~~删除线~~ `a*b` [***复合样式***](https://example.com/a\\(b\\))"
    )
    nodes = imported["doc"]["content"][0]["content"]
    spans = {
        node["text"]: {mark["type"] for mark in node.get("marks", [])}
        for node in nodes
        if node["text"].strip()
    }
    assert spans == {
        "粗体": {"bold"},
        "斜体": {"italic"},
        "删除线": {"strike"},
        "a*b": {"code"},
        "复合样式": {"link", "bold", "italic"},
    }
    href = next(
        mark["attrs"]["href"]
        for node in nodes
        for mark in node.get("marks", [])
        if mark["type"] == "link"
    )
    assert href == "https://example.com/a(b)"
    assert derive_plain_text(imported) == "粗体 斜体 删除线 a*b 复合样式"


@pytest.mark.parametrize(
    "source",
    [
        "**bold** and *italic* and ~~strike~~",
        "***combined***",
        "**bold `code`**",
        "**before [linked](https://example.com) after**",
        "*italic **strong** italic*",
        "**strong *italic* strong**",
        "[**bold** *italic* `code`](https://example.com)",
        r"literal \*stars\* \_underscores\_ \[brackets\] \\slash",
        r"escaped &amp; entity and & ordinary ampersand",
        "<b>literal HTML</b>",
        "[file](orbis-file:0190a111-1111-7111-8111-111111111111)",
        "[document](orbis-note:0190a111-1111-7111-8111-111111111111)",
        "[stored reference](javascript:existing-content)",
        r"[parentheses](https://example.com/a\(b\)?x=1&y=2)",
        "NEW_RELEASE_TEXT",
    ],
)
def test_import_export_roundtrip_preserves_text_and_supported_mark_semantics(source):
    before = markdown_to_blocks(source)
    after = markdown_to_blocks(blocks_to_markdown(before))
    assert semantic_inline(after["doc"]["content"][0]["content"]) == semantic_inline(
        before["doc"]["content"][0]["content"]
    )


@pytest.mark.parametrize(
    "source",
    [
        "a`b",
        "`start",
        "end`",
        "``double``",
        " leading and trailing ",
        "   ",
        "a*b [c] \\ d",
    ],
)
def test_code_span_export_uses_safe_fences_and_preserves_exact_text(source):
    rendered = render_text(source, {"code": True})
    assert parse_inline(rendered) == [
        {"type": "text", "text": source, "marks": [{"type": "code"}]}
    ]


@pytest.mark.parametrize(
    "styles",
    [
        {"bold": True},
        {"italic": True},
        {"strike": True},
        {"code": True},
        {"bold": True, "italic": True},
        {"bold": True, "italic": True, "code": True},
    ],
)
def test_normalized_v2_styles_export_and_import_preserve_marks(styles):
    document = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "styled",
                "type": "paragraph",
                "props": {},
                "content": [{"type": "text", "text": "Marked text", "styles": styles}],
                "children": [],
            }
        ],
    }
    nodes = markdown_to_blocks(blocks_to_markdown(document))["doc"]["content"][0][
        "content"
    ]
    assert nodes[0]["text"] == "Marked text"
    assert {mark["type"] for mark in nodes[0]["marks"]} == set(styles)


def test_export_literal_controls_does_not_accidentally_create_marks_or_links():
    value = "Literal **stars** _underline_ [link](https://example.com) `ticks` \\backslash &amp;"
    nodes = [{"type": "text", "text": value}]
    reloaded = markdown_to_blocks(blocks_to_markdown(paragraph(nodes)))
    assert reloaded["doc"]["content"][0]["content"] == nodes


def test_v2_link_keeps_inner_styles_and_literal_label_controls():
    document = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "link",
                "type": "paragraph",
                "props": {},
                "content": [
                    {
                        "type": "link",
                        "href": "https://example.com/a(b)",
                        "content": [
                            {
                                "type": "text",
                                "text": "[label]",
                                "styles": {"bold": True, "italic": True},
                            }
                        ],
                    }
                ],
                "children": [],
            }
        ],
    }
    parsed = markdown_to_blocks(blocks_to_markdown(document))["doc"]["content"][0][
        "content"
    ]
    assert parsed[0]["text"] == "[label]"
    assert {mark["type"] for mark in parsed[0]["marks"]} == {"link", "bold", "italic"}


def test_inline_image_keeps_unsupported_source_without_losing_url_or_label():
    parsed = parse_inline("inline ![alt](https://example.com/image.png) remains text")
    assert (
        "".join(node["text"] for node in parsed)
        == "inline ![alt](https://example.com/image.png) remains text"
    )


def test_v2_style_transitions_keep_existing_outer_mark_open():
    document = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "styled",
                "type": "paragraph",
                "props": {},
                "content": [
                    {"type": "text", "text": "italic ", "styles": {"italic": True}},
                    {
                        "type": "text",
                        "text": "strong",
                        "styles": {"bold": True, "italic": True},
                    },
                    {"type": "text", "text": " italic", "styles": {"italic": True}},
                ],
                "children": [],
            }
        ],
    }
    imported = markdown_to_blocks(blocks_to_markdown(document))["doc"]["content"][0][
        "content"
    ]
    assert [node["text"] for node in imported] == ["italic ", "strong", " italic"]
    assert [{mark["type"] for mark in node["marks"]} for node in imported] == [
        {"italic"},
        {"italic", "bold"},
        {"italic"},
    ]
