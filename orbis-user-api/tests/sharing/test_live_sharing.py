from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.document_share import DocumentShare
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.site import SiteRelease


def notebook(client, owner, title="Live notebook"):
    response = client.post("/notebooks", headers=owner, json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["data"]


def note(client, owner, book, title, parent=None):
    response = client.post(
        "/notes",
        headers=owner,
        json={"notebook_id": book["id"], "title": title, "parent_id": parent},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def share(client, owner, book, root=None):
    response = client.post(
        "/shares",
        headers=owner,
        json={
            "notebook_id": book["id"],
            "root_note_id": root,
            "acknowledge_public_scope": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def save(client, owner, document, blocks):
    version = client.get(f"/notes/{document['id']}/content", headers=owner).json()[
        "data"
    ]["content_version"]
    response = client.put(
        f"/notes/{document['id']}/content",
        headers=owner,
        json={
            "expected_version": version,
            "blocks": {"schema_version": 2, "editor": "blocknote", "blocks": blocks},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["content_version"]


def paragraph(text="Current online text", identifier="live-paragraph"):
    return {
        "id": identifier,
        "type": "paragraph",
        "props": {},
        "content": [{"type": "text", "text": text, "styles": {}}],
        "children": [],
    }


def public_url(link, document):
    return f"/public/shares/{link['token']}/notes/{document['id']}/content"


def test_subtree_is_live_independent_from_site_publish_and_is_revocable(
    client: TestClient, owner
):
    book = notebook(client, owner)
    root = note(client, owner, book, "Shared root")
    child = note(client, owner, book, "Nested document", root["id"])
    sibling = note(client, owner, book, "Private sibling")
    link = share(client, owner, book, root["id"])
    prefix = f"/public/shares/{link['token']}"
    tree = client.get(prefix)
    assert tree.status_code == 200, tree.text
    assert {item["id"] for item in tree.json()["data"]["items"]} == {
        root["id"],
        child["id"],
    }
    assert (
        next(item for item in tree.json()["data"]["items"] if item["id"] == root["id"])[
            "parent_id"
        ]
        is None
    )
    assert client.get(public_url(link, sibling)).status_code == 404
    version = save(
        client, owner, child, [paragraph("Edited after the link was created")]
    )
    response = client.get(public_url(link, child))
    assert response.status_code == 200, response.text
    assert "Edited after" in response.text
    assert response.json()["data"]["content_version"] == version
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert response.headers["referrer-policy"] == "no-referrer"
    added = note(client, owner, book, "Future descendant", child["id"])
    assert added["id"] in {
        item["id"] for item in client.get(prefix).json()["data"]["items"]
    }

    async def stored():
        async with client.app.state.session_factory() as session:
            record = await session.get(DocumentShare, UUID(link["id"]))
            return record.token_digest, await session.scalar(
                select(func.count(SiteRelease.id))
            )

    digest, releases = client.portal.call(stored)
    assert digest != link["token"] and len(digest) == 64 and releases == 0
    listed = client.get(
        f"/shares?notebook_id={book['id']}&root_note_id={root['id']}", headers=owner
    )
    assert (
        listed.status_code == 200
        and "token" not in listed.text
        and "token_digest" not in listed.text
    )
    assert listed.json()["data"]["items"][0]["path"] == link["path"]
    assert client.post(f"/shares/{link['id']}/revoke", headers=owner).status_code == 200
    assert client.get(prefix).status_code == 404
    assert client.get(public_url(link, child)).status_code == 404
    assert "no-store" in client.get(prefix).headers["cache-control"]


def test_moves_and_archived_ancestors_immediately_remove_public_scope(client, owner):
    book = notebook(client, owner)
    root = note(client, owner, book, "Shared root")
    child = note(client, owner, book, "Child", root["id"])
    grandchild = note(client, owner, book, "Grandchild", child["id"])
    outside = note(client, owner, book, "Outside")
    link = share(client, owner, book, root["id"])
    prefix = f"/public/shares/{link['token']}"
    moved = client.patch(
        f"/notes/{child['id']}", headers=owner, json={"parent_id": outside["id"]}
    )
    assert moved.status_code == 200, moved.text
    assert client.get(public_url(link, child)).status_code == 404
    assert client.get(public_url(link, grandchild)).status_code == 404
    assert (
        client.patch(
            f"/notes/{child['id']}", headers=owner, json={"parent_id": root["id"]}
        ).status_code
        == 200
    )
    assert client.get(public_url(link, grandchild)).status_code == 200
    assert (
        client.post(f"/notes/{child['id']}/archive", headers=owner).status_code == 200
    )
    assert client.get(public_url(link, grandchild)).status_code == 404
    assert {item["id"] for item in client.get(prefix).json()["data"]["items"]} == {
        root["id"]
    }
    assert client.post(f"/notes/{root['id']}/archive", headers=owner).status_code == 200
    assert client.get(prefix).status_code == 404


def test_notebook_share_includes_future_roots_and_paged_current_content(client, owner):
    book = notebook(client, owner)
    link = share(client, owner, book)
    root = note(client, owner, book, "Future root")
    save(
        client,
        owner,
        root,
        [paragraph(f"paragraph {index}", f"p-{index}") for index in range(80)],
    )
    first = client.get(public_url(link, root)).json()["data"]
    assert len(first["blocks"]["blocks"]) == 32 and first["has_more"]
    next_page = client.get(
        public_url(link, root),
        params={
            "offset": first["next_offset"],
            "expected_version": first["content_version"],
        },
    )
    assert next_page.status_code == 200 and next_page.json()["data"]["offset"] == 32
    save(client, owner, root, [paragraph("Newest text")])
    stale = client.get(
        public_url(link, root), params={"expected_version": first["content_version"]}
    )
    assert stale.status_code == 409 and stale.json()["code"] == "SHARE_CONTENT_CHANGED"
    assert "Newest text" in client.get(public_url(link, root)).text
    other = notebook(client, owner, "Private book")
    private = note(client, owner, other, "Private")
    assert client.get(public_url(link, private)).status_code == 404


def test_asset_requires_current_reference_scope_and_workspace(client, owner):
    book = notebook(client, owner)
    root = note(client, owner, book, "Shared")
    outside = note(client, owner, book, "Outside")
    link = share(client, owner, book, root["id"])
    uploaded = client.post(
        "/files",
        headers=owner,
        files={"file": ("image.png", b"example image", "image/png")},
    ).json()["data"]
    ref = f"orbis-file:{uploaded['id']}"
    path = f"/public/shares/{link['token']}/notes/{root['id']}/files/{uploaded['id']}"
    save(client, owner, root, [paragraph(ref)])
    assert client.get(path).status_code == 404
    save(
        client,
        owner,
        root,
        [
            {
                "id": "image",
                "type": "image",
                "props": {"url": ref, "name": "Image"},
                "content": [],
                "children": [],
            }
        ],
    )
    response = client.get(path)
    assert response.status_code == 200 and response.content == b"example image"
    assert "no-store" in response.headers["cache-control"]
    assert client.get(path.replace(root["id"], outside["id"])).status_code == 404

    async def move_asset():
        async with client.app.state.session_factory() as session:
            asset = await session.get(FileAsset, UUID(uploaded["id"]))
            asset.workspace_id = new_uuidv7()
            await session.commit()

    client.portal.call(move_asset)
    assert client.get(path).status_code == 404
    assert client.post(f"/shares/{link['id']}/revoke", headers=owner).status_code == 200
    assert client.get(path).status_code == 404


def test_create_requires_public_scope_acknowledgement_and_workspace_authority(
    client, owner
):
    book = notebook(client, owner)
    payload = {"notebook_id": book["id"], "acknowledge_public_scope": True}
    assert client.post("/shares", json=payload).status_code == 401
    rejected = client.post(
        "/shares", headers=owner, json={**payload, "acknowledge_public_scope": False}
    )
    assert (
        rejected.status_code == 422
        and rejected.json()["code"] == "SHARE_SCOPE_ACKNOWLEDGEMENT_REQUIRED"
    )
    assert (
        client.post(
            "/shares", headers=owner, json={**payload, "notebook_id": str(new_uuidv7())}
        ).status_code
        == 404
    )
    assert client.get("/public/shares/guessable-token").status_code == 404


def test_bounded_nested_and_giant_payload_reads_remain_live_and_scoped(client, owner):
    book = notebook(client, owner)
    document = note(client, owner, book, "Large current document")
    link = share(client, owner, book, document["id"])
    save(
        client,
        owner,
        document,
        [
            {
                "id": "quote",
                "type": "quote",
                "props": {},
                "content": [],
                "children": [
                    paragraph(f"Nested {index}", f"n-{index}") for index in range(1000)
                ],
            },
            paragraph("x" * 300000, "giant"),
        ],
    )
    response = client.get(public_url(link, document))
    assert response.status_code == 200, response.text
    page = response.json()["data"]
    assert len(response.content) < 128 * 1024
    assert page["blocks"]["blocks"][0]["children"] == []
    assert page["descriptors"][0]["child_count"] == 1000
    assert page["descriptors"][1]["payload_loaded"] is False
    children = client.get(
        public_url(link, document),
        params={"parent_id": "quote", "expected_version": page["content_version"]},
    )
    assert (
        children.status_code == 200
        and len(children.json()["data"]["blocks"]["blocks"]) == 32
    )
    assert (
        client.get(
            public_url(link, document), params={"parent_id": "private-parent"}
        ).status_code
        == 404
    )
    exact_url = public_url(link, document).removesuffix("content") + "blocks/giant"
    exact = client.get(exact_url, params={"expected_version": page["content_version"]})
    assert (
        exact.status_code == 200
        and exact.json()["data"]["descriptor"]["payload_loaded"]
    )
    assert len(exact.json()["data"]["block"]["content"][0]["text"]) == 300000
    save(client, owner, document, [paragraph("Latest document")])
    assert (
        client.get(
            exact_url, params={"expected_version": page["content_version"]}
        ).status_code
        == 409
    )


def test_key_rotation_preserves_bearer_access_but_never_returns_invalid_recovered_link(
    client, owner
):
    book = notebook(client, owner)
    root = note(client, owner, book, "Shared root")
    link = share(client, owner, book, root["id"])
    client.app.state.settings.action_token_secret = (
        "rotated-sharing-secret-at-least-32-bytes"
    )
    assert client.get(f"/public/shares/{link['token']}").status_code == 200
    listed = client.get(
        f"/shares?notebook_id={book['id']}&root_note_id={root['id']}", headers=owner
    )
    assert (
        listed.status_code == 200 and listed.json()["data"]["items"][0]["path"] is None
    )


def test_cross_workspace_cannot_create_list_recover_or_revoke_shares(client, owner):
    from orbis_user_api.models.user import User
    from orbis_user_api.models.workspace import Workspace, WorkspaceMember

    book = notebook(client, owner)
    root = note(client, owner, book, "Shared root")
    link = share(client, owner, book, root["id"])

    async def switch():
        async with client.app.state.session_factory() as session:
            user = await session.scalar(select(User))
            workspace = Workspace(
                owner_id=user.id, name="Isolated workspace", workspace_type="private"
            )
            session.add(workspace)
            await session.flush()
            session.add(
                WorkspaceMember(
                    workspace_id=workspace.id, user_id=user.id, role="owner"
                )
            )
            user.current_workspace_id = workspace.id
            await session.commit()

    client.portal.call(switch)
    assert (
        client.post(
            "/shares",
            headers=owner,
            json={
                "notebook_id": book["id"],
                "root_note_id": root["id"],
                "acknowledge_public_scope": True,
            },
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/shares?notebook_id={book['id']}&root_note_id={root['id']}", headers=owner
        ).json()["data"]["items"]
        == []
    )
    assert client.post(f"/shares/{link['id']}/revoke", headers=owner).status_code == 404


def test_normal_members_cannot_manage_public_scope(client, owner, tmp_path):
    import json

    book = notebook(client, owner)
    root = note(client, owner, book, "Shared root")
    link = share(client, owner, book, root["id"])
    email = "reader@example.com"
    invited = client.post(
        "/workspace/invitations", headers=owner, json={"email": email, "role": "normal"}
    )
    assert invited.status_code == 201, invited.text
    messages = [
        json.loads(path.read_text()) for path in (tmp_path / "outbox").glob("*.json")
    ]
    invitation = next(message for message in messages if message["recipient"] == email)
    accepted = client.post(
        "/workspace/invitations/accept",
        json={
            "token": invitation["token"],
            "password": "correct horse battery staple",
            "display_name": "Reader",
        },
    )
    assert accepted.status_code == 201, accepted.text
    reader = {"Authorization": f"Bearer {accepted.json()['data']['access_token']}"}
    assert (
        client.post(
            "/shares",
            headers=reader,
            json={"notebook_id": book["id"], "acknowledge_public_scope": True},
        ).status_code
        == 403
    )
    assert (
        client.get(f"/shares?notebook_id={book['id']}", headers=reader).status_code
        == 403
    )
    assert (
        client.post(f"/shares/{link['id']}/revoke", headers=reader).status_code == 403
    )


@pytest.mark.parametrize(
    "weak_secret", ["change-me-action-secret", "weak-but-valid-settings-secret"]
)
def test_weak_share_signing_configuration_blocks_only_new_links(
    client, owner, weak_secret
):
    book = notebook(client, owner)
    root = note(client, owner, book, "Existing share")
    link = share(client, owner, book, root["id"])
    client.app.state.settings.action_token_secret = weak_secret
    rejected = client.post(
        "/shares",
        headers=owner,
        json={
            "notebook_id": book["id"],
            "root_note_id": root["id"],
            "acknowledge_public_scope": True,
        },
    )
    assert (
        rejected.status_code == 503
        and rejected.json()["code"] == "SHARE_SIGNING_UNAVAILABLE"
    )
    assert client.get(f"/public/shares/{link['token']}").status_code == 200
    assert client.post(f"/shares/{link['id']}/revoke", headers=owner).status_code == 200
    assert client.get(f"/public/shares/{link['token']}").status_code == 404


def test_public_children_preserves_long_supported_opaque_parent_ids(client, owner):
    book = notebook(client, owner)
    document = note(client, owner, book, "Long opaque block IDs")
    parent_id = "opaque-" + "x" * 294
    save(
        client,
        owner,
        document,
        [
            {
                "id": parent_id,
                "type": "quote",
                "props": {},
                "content": [],
                "children": [paragraph("Nested under a 301-character ID", "child")],
            }
        ],
    )
    link = share(client, owner, book, document["id"])
    response = client.get(public_url(link, document), params={"parent_id": parent_id})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["parent_id"] == parent_id
    assert response.json()["data"]["blocks"]["blocks"][0]["id"] == "child"
