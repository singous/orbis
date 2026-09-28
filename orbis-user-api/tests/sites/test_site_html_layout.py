from __future__ import annotations

import pytest

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_html import DocumentHtml


def test_static_html_renders_authored_table_column_widths():
    source = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [{
            "id": "private-table",
            "type": "table",
            "props": {},
            "content": {
                "type": "tableContent",
                "columnWidths": [160, None, 0, 280.5],
                "rows": [{"cells": ["First", "Auto", "Zero", "Last"]}],
            },
            "children": [],
        }],
    }
    public = public_note_blocks(source)
    html = DocumentHtml("https://example.com", "Page").nodes(public["blocks"], False)
    assert '<colgroup><col style="width: 160px"><col><col style="width: 0px"><col style="width: 280.5px"></colgroup><tbody>' in html
    assert "<td>First</td><td>Auto</td><td>Zero</td><td>Last</td>" in html


@pytest.mark.parametrize("width", [True, -1, "240", float("inf"), float("nan")])
def test_static_html_ignores_invalid_table_column_widths(width):
    table = {
        "type": "table",
        "content": {"type": "tableContent", "columnWidths": [width], "rows": [{"cells": ["Cell"]}]},
    }
    html = DocumentHtml("https://example.com", "Page").block(table, False, (0,))
    assert "<colgroup><col></colgroup>" in html
    assert "<td>Cell</td>" in html


@pytest.mark.parametrize("kind", ["image", "video"])
@pytest.mark.parametrize("width", [320, 320.5])
def test_static_html_limits_media_to_the_authored_preview_width(kind, width):
    media = {
        "type": kind,
        "props": {"url": "https://example.com/media", "caption": "Preview", "previewWidth": width},
    }
    html = DocumentHtml("https://example.com", "Page").block(media, False, (0,))
    assert f'<figure style="max-width: 100%; width: {width}px">' in html
    assert '<figcaption>Preview</figcaption>' in html


@pytest.mark.parametrize("width", [True, 0, -1, "320", float("inf"), float("nan"), None])
def test_static_html_ignores_invalid_media_preview_widths(width):
    media = {"type": "image", "props": {"url": "https://example.com/media", "previewWidth": width}}
    html = DocumentHtml("https://example.com", "Page").block(media, False, (0,))
    assert html.startswith("<figure>")


def test_attachment_preview_width_does_not_change_its_layout():
    media = {"type": "file", "props": {"url": "https://example.com/file", "previewWidth": 320}}
    html = DocumentHtml("https://example.com", "Page").block(media, False, (0,))
    assert html.startswith("<figure>")
