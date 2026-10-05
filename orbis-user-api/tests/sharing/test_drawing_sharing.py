from io import BytesIO
import json

from PIL import Image


def test_live_drawing_share_returns_preview_without_editable_scene(client, owner):
    book = client.post("/notebooks", headers=owner, json={"title": "Drawing sharing"}).json()["data"]
    note = client.post("/notes", headers=owner, json={"notebook_id": book["id"], "title": "Drawing"}).json()["data"]
    image = BytesIO()
    Image.new("RGB", (20, 20), "white").save(image, format="PNG")
    upload = client.post("/files", headers=owner, files={"file": ("drawing.png", image.getvalue(), "image/png")})
    assert upload.status_code == 201, upload.text
    file_id = upload.json()["data"]["id"]
    scene = json.dumps({"version": 1, "elements": [{"id": "internal-shape-id", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 100}], "appState": {"viewBackgroundColor": "#fff"}})
    block = {"id": "drawing", "type": "drawing", "props": {"scene": scene, "url": f"orbis-file:{file_id}", "caption": "Preview"}, "content": [], "children": []}
    saved = client.put(f"/notes/{note['id']}/content", headers=owner, json={"expected_version": 1, "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": [block]}})
    assert saved.status_code == 200, saved.text
    share = client.post("/shares", headers=owner, json={"notebook_id": book["id"], "root_note_id": note["id"], "acknowledge_public_scope": True})
    assert share.status_code == 201, share.text
    token = share.json()["data"]["token"]
    prefix = f"/public/shares/{token}/notes/{note['id']}"
    for path in (prefix + "/content", prefix + "/blocks/drawing"):
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert "internal-shape-id" not in response.text and '"scene"' not in response.text
        assert f"orbis-file:{file_id}" in response.text
    preview = client.get(prefix + f"/files/{file_id}")
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/png"
    assert preview.content == image.getvalue()
    private = client.get(f"/notes/{note['id']}/content", headers=owner)
    assert private.json()["data"]["blocks"]["blocks"][0]["props"]["scene"] == scene
