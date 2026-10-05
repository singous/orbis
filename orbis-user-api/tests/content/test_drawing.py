from copy import deepcopy
import json
from uuid import UUID

import pytest

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_html import DocumentHtml
from orbis_user_api.domain.document_references import managed_file_ids
from orbis_user_api.domain.drawing import MAX_DRAWING_BYTES
from orbis_user_api.domain.note_content import InvalidNoteContent, blocks_to_markdown, derive_plain_text, normalize_note_blocks


def drawing():
    return {
        "id": "private-drawing", "type": "drawing", "content": [], "children": [],
        "props": {
            "caption": "流程图", "url": "https://example.com/drawing.png",
            "scene": json.dumps({"version": 1, "elements": [{"id": "text", "type": "text", "x": 0, "y": 0, "width": 100, "height": 30, "text": "编辑后继续绘制"}], "appState": {"viewBackgroundColor": "#ffffff"}}),
        },
    }


def document(block):
    return {"schema_version": 2, "editor": "blocknote", "blocks": [block]}


def test_drawing_persists_source_and_extracts_text_and_markdown_preview():
    source = document(drawing())
    assert normalize_note_blocks(source) == source
    assert derive_plain_text(source) == "流程图\n编辑后继续绘制"
    assert blocks_to_markdown(source) == "![流程图](https://example.com/drawing.png)"


def test_public_drawing_exposes_only_preview_and_renders_without_javascript():
    source = document(drawing())
    public = public_note_blocks(source)
    assert public["blocks"][0]["props"] == {"caption": "流程图", "url": "https://example.com/drawing.png"}
    assert "scene" not in json.dumps(public)
    html = DocumentHtml("https://example.com", "Page").nodes(public["blocks"], False)
    assert '<img src="https://example.com/drawing.png"' in html
    assert "流程图" in html
    assert "编辑后继续绘制" not in html


def test_drawing_preview_participates_in_managed_file_authorization():
    block = drawing()
    identifier = UUID("019ca55d-1111-7000-8000-000000000001")
    block["props"]["url"] = f"orbis-file:{identifier}"
    assert managed_file_ids(document(block)) == {identifier}


def test_empty_drawing_can_be_saved_and_does_not_block_publication():
    block = drawing()
    block["props"].update(scene="", url="")
    assert normalize_note_blocks(document(block))["blocks"] == [block]
    assert public_note_blocks(document(block))["blocks"] == []


@pytest.mark.parametrize("scene", ["not-json", " " * (MAX_DRAWING_BYTES + 1), {"version": 1}, "null", "[]", '{"version":99,"elements":[]}'])
def test_drawing_rejects_invalid_scenes(scene):
    block = drawing()
    block["props"]["scene"] = scene
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(block))


@pytest.mark.parametrize("patch", [{"type": "iframe"}, {"type": []}, {"x": True}, {"x": float("inf")}, {"width": -1}, {"isDeleted": True}, {"link": "javascript:alert(1)"}, {"customData": {"secret": "private"}}, {"type": "freedraw", "points": "invalid"}, {"boundElements": ["invalid"]}, {"groupIds": "invalid"}, {"endBinding": "invalid"}])
def test_drawing_rejects_unsupported_elements(patch):
    block = drawing()
    scene = json.loads(block["props"]["scene"])
    scene["elements"][0].update(patch)
    block["props"]["scene"] = json.dumps(scene)
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(block))


@pytest.mark.parametrize("field,value", [("children", [{"id": "p", "type": "paragraph", "content": [], "children": []}]), ("content", "hidden text")])
def test_drawing_is_atomic(field, value):
    block = deepcopy(drawing())
    block[field] = value
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(block))


def test_nonempty_drawing_requires_a_preview():
    block = drawing()
    block["props"]["url"] = ""
    with pytest.raises(InvalidNoteContent):
        normalize_note_blocks(document(block))
