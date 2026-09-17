from __future__ import annotations

from typing import Any

import pytest

from orbis_user_api.domain.note_content import (
    InvalidNoteContent,
    blocks_to_markdown,
    derive_plain_text,
    normalize_note_blocks,
)


def table_document(content: object) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {"id": "table", "type": "table", "props": {}, "content": content, "children": []}
        ],
    }


@pytest.mark.parametrize(("content", "expected"), [
    ([], ""),
    ("Legacy table", "Legacy table"),
    ([{"type": "text", "text": "Old cell"}], "Old cell"),
])
def test_legacy_v2_tables_remain_accepted_and_exportable(content: object, expected: str) -> None:
    document = table_document(content)
    assert normalize_note_blocks(document) == document
    assert derive_plain_text(document) == expected
    assert blocks_to_markdown(document) == expected


def test_native_table_preserves_rich_cells_and_exports_rectangular_markdown() -> None:
    document = table_document({
        "type": "tableContent",
        "columnWidths": [None, 240],
        "headerRows": 1,
        "headerCols": 0,
        "rows": [
            {"cells": ["Name", [{"type": "text", "text": "Value", "styles": {"bold": True}}]]},
            {"cells": [{
                "type": "tableCell",
                "props": {"textAlignment": "center"},
                "content": [{"type": "link", "href": "https://orbis.dev", "content": [
                    {"type": "text", "text": "Docs|API\nnext", "styles": {"italic": True}}
                ]}],
            }]},
            {"cells": [{"type": "tableCell", "content": "Partial cell"}, "Ready"]},
        ],
    })
    assert normalize_note_blocks(document) == document
    assert derive_plain_text(document) == "Name\tValue\nDocs|API\nnext\nPartial cell\tReady"
    assert blocks_to_markdown(document) == (
        "| Name | **Value** |\n| --- | --- |\n"
        "| [*Docs\\|API<br>next*](https://orbis.dev) |  |\n"
        "| Partial cell | Ready |"
    )


def test_empty_native_table_has_no_derived_text() -> None:
    document = table_document({"type": "tableContent", "rows": []})
    assert normalize_note_blocks(document) == document
    assert derive_plain_text(document) == ""
    assert blocks_to_markdown(document) == ""


def test_native_partial_links_keep_their_labels() -> None:
    document = table_document({
        "type": "tableContent", "rows": [{"cells": [[
            {"type": "link", "href": "https://orbis.dev", "content": "Docs"}
        ]]}],
    })
    assert derive_plain_text(normalize_note_blocks(document)) == "Docs"
    assert "[Docs](https://orbis.dev)" in blocks_to_markdown(document)


@pytest.mark.parametrize("invalid_content", [
    {"type": "tableContent", "rows": None},
    {"type": "tableContent", "rows": [{"cells": None}]},
    {"type": "tableContent", "rows": [{"cells": [None]}]},
    {"type": "tableContent", "rows": [{"cells": [[{"type": "text", "text": 42}]]}]},
    {"type": "tableContent", "rows": [{"cells": [[{"type": "link", "href": "https://orbis.dev", "content": 42}]]}]},
    {"type": "tableContent", "rows": [{"cells": [{"type": "tableCell", "props": [], "content": []}]}]},
    {"type": "tableContent", "rows": [], "columnWidths": [True]},
    {"type": "tableContent", "rows": [], "columnWidths": [-1]},
    {"type": "tableContent", "rows": [], "headerRows": True},
    {"type": "tableContent", "rows": [], "headerCols": -1},
])
def test_native_table_rejects_malformed_cells_and_metadata(invalid_content: object) -> None:
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(table_document(invalid_content))
