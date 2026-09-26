from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.application.site_html import DocumentHtml


def block(kind: str, text: str = "", *, children=None) -> dict[str, Any]:
    return {
        "id": f"private-{kind}",
        "type": kind,
        "props": {"level": 2} if kind == "heading" else {},
        "content": [{"type": "text", "text": text}] if text else [],
        "children": children or [],
    }


@pytest.mark.parametrize(
    ("items", "anchor", "label"),
    [
        ([block("image"), block("heading", "Details")], "heading-1", "Details"),
        (
            [block("image"), block("heading", "Internal document")],
            "heading-1",
            "Internal document",
        ),
        (
            [block("quote", children=[block("file"), block("heading", "Nested")])],
            "heading-0-1",
            "Nested",
        ),
        (
            [block("heading", "Internal document", children=[block("audio"), block("heading", "Nested")])],
            "heading-0-1",
            "Nested",
        ),
    ],
    ids=["root-placeholder", "title-after-placeholder", "nested-placeholder", "suppressed-title-children"],
)
def test_authored_heading_links_survive_preview_and_immutable_publication(
    client, owner, document, items, anchor, label
):
    items = deepcopy(items)
    links = block("paragraph")
    links["content"] = [
        {"type": "link", "href": href, "content": [{"type": "text", "text": "Jump"}]}
        for href in (f"#{anchor}", f"/documents/{document['id']}#{anchor}")
    ]
    items.append(links)
    source = {"schema_version": 2, "editor": "blocknote", "blocks": items}
    saved = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={"expected_version": 1, "blocks": source},
    )
    assert saved.status_code == 200, saved.text
    saved_source = client.get(f"/notes/{document['id']}/content", headers=owner).json()["data"]
    created = client.post(
        "/sites",
        headers=owner,
        json={
            "name": "Anchor handbook",
            "slug": "anchor-handbook",
            "description": "Stable heading links",
            "site_kind": "handbook",
            "accent_color": "#0f766e",
            "navigation": [{"note_id": document["id"], "slug": "guide", "title": document["title"]}],
        },
    )
    assert created.status_code == 201, created.text
    site_id = created.json()["data"]["id"]

    preview = client.get(f"/sites/{site_id}/preview", headers=owner)
    assert preview.status_code == 200, preview.text
    preview_page = preview.json()["data"]["pages"][0]
    public_blocks = preview_page["blocks"]
    assert public_blocks["blocks"][-1]["content"][0]["href"] == f"#{anchor}"
    assert public_blocks["blocks"][-1]["content"][1]["href"] == f"/s/anchor-handbook/guide#{anchor}"
    renderer = DocumentHtml("http://testserver", document["title"])
    preview_html = renderer.nodes(public_blocks["blocks"], False)
    assert f'id="{anchor}"' in preview_html
    assert renderer.outline == [(anchor, label)]
    published = client.post(f"/sites/{site_id}/publish", headers=owner)
    assert published.status_code == 200, published.text
    snapshot = published.json()["data"]
    assert snapshot["pages"][0]["blocks"] == public_blocks
    html = client.get("/s/anchor-handbook/guide").text
    assert f'id="{anchor}"' in html
    assert f'href="#{anchor}"' in html
    assert f'/s/anchor-handbook/guide#{anchor}' in html
    assert client.get(f"/notes/{document['id']}/content", headers=owner).json()["data"] == saved_source

    changed = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={
            "expected_version": saved_source["content_version"],
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": [block("paragraph", "Changed draft")]},
        },
    )
    assert changed.status_code == 200, changed.text
    assert client.get("/public/sites/anchor-handbook").json()["data"] == snapshot
    assert f'id="{anchor}"' in client.get("/s/anchor-handbook/guide").text


def test_reprojected_public_blocks_keep_nested_heading_paths():
    source = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [block("image"), block("quote", children=[block("video"), block("heading", "Nested")])],
    }
    before = deepcopy(source)
    projected = public_note_blocks(source)
    assert projected["blocks"][0]["id"] == "public-1"
    assert projected["blocks"][0]["children"][0]["id"] == "public-1-1"
    assert public_note_blocks(projected) == projected
    assert source == before


@pytest.mark.parametrize("identifier", ["private-heading", "public-01", "public--1", "public-1.5", "public-1-extra"])
def test_noncanonical_public_ids_use_positional_heading_paths(identifier):
    heading = block("heading", "Details")
    heading["id"] = identifier
    renderer = DocumentHtml("https://example.com", "Page")
    assert 'id="heading-0"' in renderer.nodes([heading], False)
    assert renderer.outline == [("heading-0", "Details")]
