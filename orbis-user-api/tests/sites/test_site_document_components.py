from __future__ import annotations

import json


def test_authored_components_round_trip_through_save_preview_publish_and_markdown(
    client, owner, document
):
    def block(kind, text="", props=None, children=None):
        return {
            "id": f"internal-{kind}-{text}",
            "type": kind,
            "props": props or {},
            "content": [{"type": "text", "text": text}] if text else [],
            "children": children or [],
        }

    blocks = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            block("callout", "先阅读说明", {"title": "发布提示", "tone": "info"}),
            block(
                "cardGroup",
                children=[
                    block(
                        "card",
                        props={
                            "title": "入门",
                            "href": "https://example.com/start",
                            "private_id": "secret",
                        },
                        children=[block("paragraph", "入门内容")],
                    )
                ],
            ),
            block(
                "steps",
                children=[
                    block(
                        "step",
                        props={"title": "创建笔记本"},
                        children=[block("paragraph", "编辑文档")],
                    )
                ],
            ),
            block(
                "tabs",
                children=[
                    block(
                        "tab",
                        props={"title": "Linux"},
                        children=[block("paragraph", "Linux 安装")],
                    ),
                    block(
                        "tab",
                        props={"title": "macOS"},
                        children=[block("paragraph", "macOS 安装")],
                    ),
                ],
            ),
            block(
                "codeGroup",
                children=[
                    block("codeBlock", "print('ok')", {"language": "python"}),
                    block("codeBlock", "console.log('ok')", {"language": "javascript"}),
                ],
            ),
        ],
    }
    saved = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={"expected_version": 1, "blocks": blocks},
    )
    assert saved.status_code == 200, saved.text
    read = client.get(f"/notes/{document['id']}/content", headers=owner).json()["data"]
    assert read["blocks"] == saved.json()["data"]["blocks"]
    site = client.post(
        "/sites",
        headers=owner,
        json={
            "name": "Components",
            "slug": "components",
            "navigation": [
                {"note_id": document["id"], "title": "Components", "slug": "start"}
            ],
        },
    ).json()["data"]
    preview = client.get(f"/sites/{site['id']}/preview", headers=owner)
    assert preview.status_code == 200, preview.text
    release = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert release.status_code == 200, release.text
    public = client.get("/public/sites/components").json()["data"]
    assert public["pages"][0]["blocks"] == preview.json()["data"]["pages"][0]["blocks"]
    assert "secret" not in json.dumps(public)
    assert document["id"] not in json.dumps(public)
    markdown = client.get(f"/notes/{document['id']}/markdown", headers=owner)
    assert markdown.status_code == 200, markdown.text
    for text in [
        "发布提示",
        "先阅读说明",
        "入门",
        "入门内容",
        "创建笔记本",
        "Linux 安装",
        "macOS 安装",
        "print('ok')",
        "console.log('ok')",
    ]:
        assert text in public["pages"][0]["plain_text"]
        assert text in markdown.json()["data"]["markdown"]
