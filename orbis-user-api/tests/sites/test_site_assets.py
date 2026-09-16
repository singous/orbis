from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from orbis_user_api.application.site_assets import file_reference
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.site import SiteRelease


def _site_config(*pages: tuple[dict[str, Any], str]) -> dict[str, Any]:
    return {
        "name": "Asset handbook",
        "slug": "asset-handbook",
        "description": "Published assets",
        "site_kind": "handbook",
        "accent_color": "#0f766e",
        "navigation": [
            {
                "note_id": note["id"],
                "slug": slug,
                "title": note["title"],
                "group": "Guides",
            }
            for note, slug in pages
        ],
    }


def _create_site(
    client: TestClient,
    owner: dict[str, str],
    *pages: tuple[dict[str, Any], str],
) -> dict[str, Any]:
    response = client.post("/sites", headers=owner, json=_site_config(*pages))
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _save_content(
    client: TestClient,
    owner: dict[str, str],
    note_id: str,
    block_items: list[dict[str, Any]],
) -> None:
    current = client.get(f"/notes/{note_id}/content", headers=owner).json()["data"]
    response = client.put(
        f"/notes/{note_id}/content",
        headers=owner,
        json={
            "expected_version": current["content_version"],
            "blocks": {
                "schema_version": 2,
                "editor": "blocknote",
                "blocks": block_items,
            },
        },
    )
    assert response.status_code == 200, response.text


def _upload(
    client: TestClient,
    owner: dict[str, str],
    filename: str,
    contents: bytes,
    media_type: str,
) -> dict[str, Any]:
    response = client.post(
        "/files",
        headers=owner,
        files={"file": (filename, contents, media_type)},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _media_block(kind: str, reference: str, *, name: str = "Asset") -> dict[str, Any]:
    return {
        "id": f"private-{kind}",
        "type": kind,
        "props": {"url": reference, "name": name, "caption": name},
        "content": [],
    }


def _link_block(*links: str) -> dict[str, Any]:
    return {
        "id": "private-links",
        "type": "paragraph",
        "props": {},
        "content": [
            {
                "type": "link",
                "href": href,
                "content": [{"type": "text", "text": f"Link {index}", "styles": {}}],
            }
            for index, href in enumerate(links)
        ],
    }


def test_preview_verifies_managed_files_without_granting_anonymous_access_and_publish_serves_bytes(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    image_bytes = b"\x89PNG\r\n\x1a\npublic image"
    file_bytes = b"published guide"
    image = _upload(client, owner, "cover.png", image_bytes, "image/png")
    attachment = _upload(client, owner, "guide.txt", file_bytes, "text/plain")
    image_ref = file_reference(UUID(image["id"]))
    attachment_ref = file_reference(UUID(attachment["id"]))
    _save_content(
        client,
        owner,
        document["id"],
        [
            _media_block("image", image_ref, name="Cover"),
            _link_block(attachment_ref),
            {
                "id": "private-card",
                "type": "card",
                "props": {"title": "Download", "href": attachment_ref},
                "content": [],
                "children": [],
            },
        ],
    )
    site = _create_site(client, owner, (document, "start"))
    image_url = f"/public/sites/asset-handbook/assets/{image['sha256']}"
    attachment_url = (
        f"/public/sites/asset-handbook/assets/{attachment['sha256']}"
    )

    assert client.get(f"/sites/{site['id']}/preview").status_code == 401
    preview = client.get(f"/sites/{site['id']}/preview", headers=owner)
    assert preview.status_code == 200, preview.text
    preview_body = json.dumps(preview.json()["data"])
    assert image_ref in preview_body and attachment_ref in preview_body
    assert preview.headers["cache-control"] == "no-store"
    assert preview.headers["x-robots-tag"] == "noindex, nofollow"
    assert client.get(image_url).status_code == 404
    assert client.get(attachment_url).status_code == 404

    published = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert published.status_code == 200, published.text
    public_body = json.dumps(published.json()["data"])
    assert image_url in public_body and attachment_url in public_body
    assert image["id"] not in public_body and attachment["id"] not in public_body
    assert document["workspace_id"] not in public_body

    image_response = client.get(image_url)
    assert image_response.status_code == 200
    assert image_response.content == image_bytes
    assert image_response.headers["content-type"].startswith("image/png")
    assert image_response.headers["content-disposition"].startswith("inline;")
    assert image_response.headers["cache-control"] == "no-store"
    assert image_response.headers["x-content-type-options"] == "nosniff"
    assert image_response.headers["content-security-policy"] == (
        "default-src 'none'; sandbox; frame-ancestors 'none'"
    )
    partial = client.get(attachment_url, headers={"Range": "bytes=2-7"})
    assert partial.status_code == 206
    assert partial.content == file_bytes[2:8]
    assert partial.headers["content-range"] == f"bytes 2-7/{len(file_bytes)}"
    original = client.get(f"/files/{attachment['id']}/content", headers=owner)
    assert original.status_code == 200 and original.content == file_bytes

    async def read_manifest() -> dict[str, Any]:
        async with client.app.state.session_factory() as session:
            release = await session.get(
                SiteRelease, UUID(published.json()["data"]["release_id"])
            )
            assert release is not None
            return release.asset_manifest

    manifest = client.portal.call(read_manifest)
    assert set(manifest) == {image["id"], attachment["id"]}
    assert manifest[image["id"]] == {
        "key": image["sha256"],
        "filename": "cover.png",
        "media_type": "image/png",
        "size": len(image_bytes),
    }


def test_active_release_manifest_controls_republish_rollback_and_unpublish(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    first = _upload(client, owner, "first.txt", b"first release", "text/plain")
    second = _upload(client, owner, "second.txt", b"second release", "text/plain")
    site = _create_site(client, owner, (document, "start"))
    first_url = f"/public/sites/asset-handbook/assets/{first['sha256']}"
    second_url = f"/public/sites/asset-handbook/assets/{second['sha256']}"

    _save_content(
        client,
        owner,
        document["id"],
        [_media_block("file", file_reference(UUID(first["id"])))],
    )
    first_release = client.post(
        f"/sites/{site['id']}/publish", headers=owner
    ).json()["data"]
    assert client.get(first_url).content == b"first release"
    assert client.get(second_url).status_code == 404

    _save_content(
        client,
        owner,
        document["id"],
        [_media_block("file", file_reference(UUID(second["id"])))],
    )
    second_release = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert second_release.status_code == 200, second_release.text
    assert client.get(first_url).status_code == 404
    assert client.get(second_url).content == b"second release"

    restored = client.post(
        f"/sites/{site['id']}/releases/{first_release['release_id']}/activate",
        headers=owner,
    )
    assert restored.status_code == 200, restored.text
    assert client.get(first_url).content == b"first release"
    assert client.get(second_url).status_code == 404

    withdrawn = client.post(f"/sites/{site['id']}/unpublish", headers=owner)
    assert withdrawn.status_code == 200
    assert client.get(first_url).status_code == 404
    assert client.get(second_url).status_code == 404


def test_selected_internal_note_links_are_rewritten_without_exposing_note_ids(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    target = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": document["notebook_id"], "title": "Target"},
    ).json()["data"]
    _save_content(
        client,
        owner,
        target["id"],
        [
            {
                "id": "private-heading",
                "type": "heading",
                "props": {"level": 2},
                "content": [{"type": "text", "text": "Details", "styles": {}}],
                "children": [],
            }
        ],
    )
    canonical = f"orbis-note:{target['id']}"
    relative = f"/documents/{target['id']}#heading-0"
    absolute = f"http://testserver/documents/{target['id']}#heading-0"
    external_lookalike = f"https://example.com/documents/{target['id']}"
    _save_content(
        client,
        owner,
        document["id"],
        [_link_block(canonical, relative, absolute, external_lookalike)],
    )
    site = _create_site(client, owner, (document, "start"), (target, "target"))

    published = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert published.status_code == 200, published.text
    body = json.dumps(published.json()["data"])
    assert body.count("/s/asset-handbook/target") == 3
    assert body.count("/s/asset-handbook/target#heading-0") == 2
    assert external_lookalike in body
    assert canonical not in body and relative not in body and absolute not in body


@pytest.mark.parametrize(
    "reference",
    [
        "orbis-file:not-a-uuid",
        f"orbis-file:{str(new_uuidv7()).upper()}",
        "orbis-note:not-a-uuid",
        f"/documents/{new_uuidv7()}#missing-heading",
    ],
)
def test_malformed_or_unresolved_internal_references_name_the_source_page(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
    reference: str,
) -> None:
    _save_content(client, owner, document["id"], [_link_block(reference)])
    site = _create_site(client, owner, (document, "start"))

    preview = client.get(f"/sites/{site['id']}/preview", headers=owner)
    assert preview.status_code == 422, preview.text
    assert preview.json()["code"] == "SITE_REFERENCE_INVALID"
    assert document["title"] in preview.json()["message"]
    assert document["id"] not in preview.text
    published = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert published.status_code == 422
    assert client.get("/public/sites/asset-handbook").status_code == 404


def test_malformed_url_returns_page_specific_validation_for_preview_and_publish(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    malformed = "https://[broken/documents/0190a111-1111-7111-8111-111111111111"
    _save_content(client, owner, document["id"], [_link_block(malformed)])
    site = _create_site(client, owner, (document, "start"))

    for method, suffix in ((client.get, "preview"), (client.post, "publish")):
        response = method(f"/sites/{site['id']}/{suffix}", headers=owner)
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "SITE_REFERENCE_INVALID"
        assert document["title"] in response.json()["message"]
        assert malformed not in response.text

    assert client.get("/public/sites/asset-handbook").status_code == 404


def test_unselected_note_and_cross_workspace_file_references_are_rejected(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    unselected = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": document["notebook_id"], "title": "Private target"},
    ).json()["data"]
    uploaded = _upload(client, owner, "private.txt", b"private", "text/plain")
    site = _create_site(client, owner, (document, "start"))

    _save_content(
        client,
        owner,
        document["id"],
        [_link_block(f"orbis-note:{unselected['id']}")],
    )
    unselected_result = client.get(f"/sites/{site['id']}/preview", headers=owner)
    assert unselected_result.status_code == 422
    assert unselected_result.json()["code"] == "SITE_REFERENCE_INVALID"
    assert document["title"] in unselected_result.json()["message"]
    assert unselected["id"] not in unselected_result.text

    async def move_file() -> None:
        async with client.app.state.session_factory() as session:
            asset = await session.get(FileAsset, UUID(uploaded["id"]))
            assert asset is not None
            asset.workspace_id = new_uuidv7()
            await session.commit()

    client.portal.call(move_file)
    _save_content(
        client,
        owner,
        document["id"],
        [_media_block("file", file_reference(UUID(uploaded["id"])))],
    )
    foreign_result = client.get(f"/sites/{site['id']}/preview", headers=owner)
    assert foreign_result.status_code == 422
    assert foreign_result.json()["code"] == "SITE_REFERENCE_INVALID"
    assert document["title"] in foreign_result.json()["message"]
    assert uploaded["id"] not in foreign_result.text


def test_internal_note_reference_cannot_be_hidden_in_a_media_prop(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    reference = f"orbis-note:{document['id']}"
    _save_content(
        client,
        owner,
        document["id"],
        [_link_block(reference), _media_block("image", reference)],
    )
    site = _create_site(client, owner, (document, "start"))

    response = client.get(f"/sites/{site['id']}/preview", headers=owner)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "SITE_REFERENCE_INVALID"
    assert document["title"] in response.json()["message"]


def test_legacy_release_without_asset_manifest_authorizes_no_global_hash(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
) -> None:
    uploaded = _upload(client, owner, "legacy.txt", b"legacy bytes", "text/plain")
    site = _create_site(client, owner, (document, "start"))
    _save_content(
        client,
        owner,
        document["id"],
        [_media_block("file", file_reference(UUID(uploaded["id"])))],
    )
    released = client.post(f"/sites/{site['id']}/publish", headers=owner)
    assert released.status_code == 200, released.text
    asset_url = f"/public/sites/asset-handbook/assets/{uploaded['sha256']}"
    assert client.get(asset_url).status_code == 200

    async def clear_manifest() -> None:
        async with client.app.state.session_factory() as session:
            release = await session.get(
                SiteRelease, UUID(released.json()["data"]["release_id"])
            )
            assert release is not None
            release.asset_manifest = {}
            await session.commit()

    client.portal.call(clear_manifest)
    assert client.get(asset_url).status_code == 404


def test_publish_reverifies_original_bytes_before_switching_active_release(
    client: TestClient,
    owner: dict[str, str],
    document: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from orbis_user_api.application import sites

    site = _create_site(client, owner, (document, "start"))
    original = client.post(f"/sites/{site['id']}/publish", headers=owner).json()[
        "data"
    ]
    uploaded = _upload(client, owner, "changing.txt", b"original", "text/plain")
    _save_content(
        client,
        owner,
        document["id"],
        [_media_block("file", file_reference(UUID(uploaded["id"])))],
    )
    build_snapshot = sites.build_snapshot

    async def mutate_after_snapshot(record, session, *, url_policy):
        snapshot = await build_snapshot(record, session, url_policy=url_policy)
        asset = await session.get(FileAsset, UUID(uploaded["id"]))
        assert asset is not None
        (client.app.state.storage.root / asset.storage_key).write_bytes(b"tampered")
        return snapshot

    monkeypatch.setattr(sites, "build_snapshot", mutate_after_snapshot)
    rejected = client.post(f"/sites/{site['id']}/publish", headers=owner)

    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["code"] == "SITE_ASSET_CHANGED"
    assert document["title"] in rejected.json()["message"]
    assert client.get("/public/sites/asset-handbook").json()["data"] == original
    history = client.get(f"/sites/{site['id']}/releases", headers=owner).json()["data"]
    assert history["pagination"]["total"] == 1


def test_public_asset_route_openapi_is_a_narrow_binary_exception() -> None:
    from orbis_user_api.main import create_app

    operation = create_app().openapi()["paths"][
        "/public/sites/{slug}/assets/{key}"
    ]["get"]

    assert "读取公开站点资源" in operation["summary"]
    assert "活动发布版本" in operation["description"]
    assert operation.get("security") in (None, [])
    assert operation["responses"]["200"]["content"] == {
        "application/octet-stream": {
            "schema": {"type": "string", "format": "binary"}
        }
    }
    assert "SITE_ASSET_NOT_FOUND" in operation["responses"]["404"]["content"][
        "application/json"
    ]["examples"]
