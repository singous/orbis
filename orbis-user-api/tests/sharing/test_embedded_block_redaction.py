"""Public readers redact both embedded editors in the same document."""

import json
from io import BytesIO
from uuid import uuid4

from PIL import Image

from orbis_user_api.application.block_pages import json_bytes


def test_mixed_embedded_blocks_keep_private_source_out_of_public_reads(client, owner):
    book_response = client.post(
        "/notebooks", headers=owner, json={"title": "Embedded editor sharing"}
    )
    assert book_response.status_code == 201, book_response.text
    book = book_response.json()["data"]
    note_response = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": book["id"], "title": "Drawing and table"},
    )
    assert note_response.status_code == 201, note_response.text
    note = note_response.json()["data"]
    base = f"/notes/{note['id']}"

    image = BytesIO()
    Image.new("RGB", (20, 20), "white").save(image, format="PNG")
    upload = client.post(
        "/files",
        headers=owner,
        files={"file": ("drawing.png", image.getvalue(), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    preview_url = f"orbis-file:{upload.json()['data']['id']}"
    scene = json.dumps(
        {
            "version": 1,
            "elements": [
                {
                    "id": "private-shape-id",
                    "type": "rectangle",
                    "x": 0,
                    "y": 0,
                    "width": 100,
                    "height": 100,
                }
            ],
            "appState": {"viewBackgroundColor": "#fff"},
        }
    )
    private_snapshot = {"rows": [["Private snapshot value"]]}
    blocks = [
        {
            "id": "drawing-block",
            "type": "drawing",
            "props": {"scene": scene, "url": preview_url, "caption": "流程草图"},
            "content": [],
            "children": [],
        },
        {
            "id": "table-block",
            "type": "dataTable",
            "props": {},
            "table_snapshot": private_snapshot,
            "content": [],
            "children": [],
        },
    ]
    saved = client.put(
        base + "/content",
        headers=owner,
        json={
            "expected_version": 1,
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": blocks},
        },
    )
    assert saved.status_code == 200, saved.text
    created = client.post(
        base + "/tables",
        headers=owner,
        json={
            "operation_id": str(uuid4()),
            "expected_document_version": 2,
            "block_id": "table-block",
        },
    )
    assert created.status_code == 201, created.text
    table_id = created.json()["data"]["table_id"]

    private_response = client.get(base + "/content", headers=owner)
    assert private_response.status_code == 200, private_response.text
    private_blocks = {
        block["id"]: block
        for block in private_response.json()["data"]["blocks"]["blocks"]
    }
    assert private_blocks["drawing-block"]["props"]["scene"] == scene
    private_table = private_blocks["table-block"]
    assert private_table["props"]["field_names"]
    assert private_table["props"]["default_view_id"]
    assert private_table["table_snapshot"] == private_snapshot

    shared = client.post(
        "/shares",
        headers=owner,
        json={
            "notebook_id": book["id"],
            "root_note_id": note["id"],
            "acknowledge_public_scope": True,
        },
    )
    assert shared.status_code == 201, shared.text
    token = shared.json()["data"]["token"]
    public_base = f"/public/shares/{token}/notes/{note['id']}"

    def assert_projected(block):
        if block["type"] == "drawing":
            assert "scene" not in block["props"]
            assert block["props"]["url"] == preview_url
            assert block["props"]["caption"] == "流程草图"
        else:
            assert block["type"] == "dataTable"
            assert block["props"]["table_id"] == table_id
            assert "field_names" not in block["props"]
            assert "default_view_id" not in block["props"]
            assert "table_snapshot" not in block

    for offset, block_id in enumerate(("drawing-block", "table-block")):
        response = client.get(
            public_base + "/content", params={"offset": offset, "limit": 1}
        )
        assert response.status_code == 200, response.text
        page = response.json()["data"]
        projected = page["blocks"]["blocks"]
        assert [block["id"] for block in projected] == [block_id]
        assert page["returned_bytes"] == sum(json_bytes(block) for block in projected)
        assert page["has_more"] is (offset == 0)
        assert_projected(projected[0])

        single = client.get(public_base + f"/blocks/{block_id}")
        assert single.status_code == 200, single.text
        assert_projected(single.json()["data"]["block"])
        assert "private-shape-id" not in response.text + single.text
        assert "Private snapshot value" not in response.text + single.text

        private_single = client.get(base + f"/blocks/{block_id}", headers=owner)
        assert private_single.status_code == 200, private_single.text
        assert private_single.json()["data"]["block"] == private_blocks[block_id]
