from __future__ import annotations

from uuid import UUID

import pytest

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.workspace import Workspace, WorkspaceMember


def make_workspace(
    client, actor, *, role="owner", status="active", member_status="active", join=True
):
    workspace = Workspace(
        id=new_uuidv7(),
        owner_id=UUID(actor[0]["user"]["id"]),
        name="Second space",
        workspace_type="team",
        status=status,
    )
    member = WorkspaceMember(
        id=new_uuidv7(),
        workspace_id=workspace.id,
        user_id=workspace.owner_id,
        role=role,
        status=member_status,
    )

    async def persist():
        async with client.app.state.session_factory() as session:
            session.add(workspace)
            if join:
                session.add(member)
            await session.commit()

    client.portal.call(persist)
    return workspace, member


def changed(client, model, identifier, **values):
    async def update():
        async with client.app.state.session_factory() as session:
            row = await session.get(model, identifier)
            for key, value in values.items():
                setattr(row, key, value)
            await session.commit()

    client.portal.call(update)


def context(actor, workspace_id):
    return {**actor[1], "X-Workspace-ID": str(workspace_id)}


def create_document(client, headers, title):
    group = client.post(
        "/document-groups", headers=headers, json={"name": title, "sort_order": 0}
    )
    assert group.status_code == 201, group.text
    book = client.post(
        "/notebooks",
        headers=headers,
        json={"title": title, "group_id": group.json()["data"]["id"], "sort_order": 0},
    )
    assert book.status_code == 201, book.text
    note = client.post(
        "/notes",
        headers=headers,
        json={"notebook_id": book.json()["data"]["id"], "title": title},
    )
    assert note.status_code == 201, note.text
    return group.json()["data"], book.json()["data"], note.json()["data"]


def test_header_context_scopes_documents_files_sites_and_comments_without_mutating_default(
    client, actor
):
    original = client.get("/users/me", headers=actor[1]).json()["data"]
    second, _ = make_workspace(client, actor)
    first_headers = context(actor, original["current_workspace_id"])
    second_headers = context(actor, second.id)
    _first_group, first_book, first_note = create_document(
        client, first_headers, "First needle"
    )
    second_group, second_book, second_note = create_document(
        client, second_headers, "Second needle"
    )
    assert second_note["workspace_id"] == str(second.id)
    assert (
        client.get("/notes", headers=second_headers).json()["data"]["items"][0]["id"]
        == second_note["id"]
    )
    assert (
        client.get("/notes", headers=actor[1]).json()["data"]["items"][0]["id"]
        == first_note["id"]
    )
    assert (
        client.get("/notebooks", headers=second_headers).json()["data"]["items"][0][
            "id"
        ]
        == second_book["id"]
    )
    assert {
        item["id"]
        for item in client.get("/document-groups", headers=second_headers).json()[
            "data"
        ]["items"]
    } == {second_group["id"]}
    for path in [
        f"/notes/{first_note['id']}",
        f"/notes/{first_note['id']}/content",
        f"/notebooks/{first_book['id']}",
        f"/notebooks/{first_book['id']}/notes/tree",
        f"/notes/{first_note['id']}/comments",
    ]:
        assert client.get(path, headers=second_headers).status_code == 404, path
    assert (
        client.patch(
            f"/notes/{first_note['id']}",
            headers=second_headers,
            json={"title": "wrong context"},
        ).status_code
        == 404
    )
    blocks = {
        "schema_version": 2,
        "editor": "blocknote",
        "blocks": [
            {
                "id": "body",
                "type": "paragraph",
                "props": {},
                "content": [{"type": "text", "text": "Second body"}],
                "children": [],
            }
        ],
    }
    assert (
        client.put(
            f"/notes/{first_note['id']}/content",
            headers=second_headers,
            json={"expected_version": 1, "blocks": blocks},
        ).status_code
        == 404
    )
    saved = client.put(
        f"/notes/{second_note['id']}/content",
        headers=second_headers,
        json={"expected_version": 1, "blocks": blocks},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["plain_text"] == "Second body"
    assert (
        client.post(
            "/notes",
            headers=second_headers,
            json={"notebook_id": first_book["id"], "title": "wrong book"},
        ).status_code
        == 404
    )
    comment = client.post(
        f"/notes/{second_note['id']}/comments",
        headers=second_headers,
        json={"body": "Second comment"},
    )
    assert comment.status_code == 201, comment.text
    assert (
        client.get(
            f"/notes/{second_note['id']}/comments", headers=first_headers
        ).status_code
        == 404
    )
    upload = client.post(
        "/files",
        headers=second_headers,
        files={"file": ("second.txt", b"second content", "text/plain")},
    )
    assert upload.status_code == 201, upload.text
    file_id = upload.json()["data"]["id"]
    assert (
        client.get("/files", headers=second_headers).json()["data"]["items"][0]["id"]
        == file_id
    )
    assert client.get("/files", headers=first_headers).json()["data"]["items"] == []
    assert (
        client.get(f"/files/{file_id}/content", headers=second_headers).content
        == b"second content"
    )
    assert (
        client.get(f"/files/{file_id}/content", headers=first_headers).status_code
        == 404
    )
    site = client.post(
        "/sites",
        headers=second_headers,
        json={
            "name": "Second portal",
            "slug": "second-portal",
            "site_kind": "handbook",
            "accent_color": "#0f766e",
            "navigation": [],
        },
    )
    assert site.status_code == 201, site.text
    assert (
        client.get(
            f"/sites/{site.json()['data']['id']}", headers=first_headers
        ).status_code
        == 404
    )
    assert client.get("/users/me", headers=actor[1]).json()["data"] == original
    assert (
        client.get(f"/notes/{first_note['id']}", headers=first_headers).json()["data"][
            "title"
        ]
        == "First needle"
    )


@pytest.mark.parametrize(
    "failure", ["nonmember", "workspace", "membership", "role", "missing", "invalid"]
)
def test_explicit_unavailable_context_is_rejected_without_fallback(
    client, actor, failure
):
    second, member = make_workspace(client, actor, join=failure != "nonmember")
    if failure == "workspace":
        changed(client, Workspace, second.id, status="archived")
    elif failure == "membership":
        changed(client, WorkspaceMember, member.id, status="removed")
    elif failure == "role":
        changed(client, WorkspaceMember, member.id, role="unknown")
    value = (
        "not-a-uuid"
        if failure == "invalid"
        else new_uuidv7()
        if failure == "missing"
        else second.id
    )
    for path in [
        "/notes",
        "/notebooks",
        "/document-groups",
        "/sites",
        "/files",
        "/workspace/members",
        "/search?q=needle",
    ]:
        response = client.get(path, headers=context(actor, value))
        assert response.status_code == (422 if failure == "invalid" else 403), (
            path,
            response.text,
        )
        assert response.json()["code"] == (
            "WORKSPACE_CONTEXT_INVALID"
            if failure == "invalid"
            else "WORKSPACE_CONTEXT_FORBIDDEN"
        )
    assert (
        client.get("/users/me", headers=actor[1]).json()["data"]["current_workspace_id"]
        == actor[0]["workspace"]["id"]
    )


def test_permissions_use_request_membership_not_default_workspace_role(client, actor):
    second, _ = make_workspace(client, actor, role="normal")
    response = client.post(
        "/document-groups",
        headers=context(actor, second.id),
        json={"name": "Cannot write as default-space owner", "sort_order": 0},
    )
    assert response.status_code == 403
    assert (
        client.get("/document-groups", headers=context(actor, second.id)).status_code
        == 200
    )


def test_search_legacy_query_parameters_cannot_escape_request_context(client, actor):
    second, _ = make_workspace(client, actor)
    create_document(client, actor[1], "First needle")
    _, _, note = create_document(client, context(actor, second.id), "Second needle")
    for query in [
        {},
        {"scope": "all"},
        {"workspace_id": actor[0]["workspace"]["id"]},
        {"scope": "all", "workspace_id": str(new_uuidv7())},
    ]:
        response = client.get(
            "/search",
            headers=context(actor, second.id),
            params={"q": "needle", **query},
        )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert {item["workspace_id"] for item in data["items"]} == {str(second.id)}
        assert data["scope"] == {
            "workspace_ids": [str(second.id)],
            "current_workspace_id": str(second.id),
        }
        assert data["workspaces"] == [
            {"id": str(second.id), "name": second.name, "is_current": True}
        ]
    assert (
        client.get(
            "/search",
            headers=actor[1],
            params={"type": "document", "resource_id": note["id"]},
        ).json()["data"]["items"]
        == []
    )


def test_workspace_listing_is_read_only_and_only_explicit_switch_persists_default(
    client, actor
):
    second, _ = make_workspace(client, actor)
    make_workspace(client, actor, join=False)
    make_workspace(client, actor, status="archived")
    make_workspace(client, actor, role="unknown")
    before = client.get("/users/me", headers=actor[1]).json()["data"]
    listed = client.get("/workspaces", headers=actor[1])
    assert listed.status_code == 200, listed.text
    assert {item["id"] for item in listed.json()["data"]["items"]} == {
        before["current_workspace_id"],
        str(second.id),
    }
    scoped = client.get("/workspaces", headers=context(actor, second.id)).json()[
        "data"
    ]["items"]
    assert [item["id"] for item in scoped if item["is_current"]] == [str(second.id)]
    assert client.get("/users/me", headers=actor[1]).json()["data"] == before
    switched = client.post(
        "/workspace/switch", headers=actor[1], json={"workspace_id": str(second.id)}
    )
    assert switched.status_code == 200, switched.text
    data = switched.json()["data"]
    assert data["user"]["current_workspace_id"] == str(second.id)
    assert data["workspace"]["is_current"] is True
    assert (
        client.post(
            "/workspace/switch", headers=actor[1], json={"workspace_id": str(second.id)}
        ).json()["data"]
        == data
    )
    # A context captured before the switch still targets its original workspace.
    first = client.get(
        "/search", headers=context(actor, before["current_workspace_id"])
    ).json()["data"]
    assert first["scope"]["current_workspace_id"] == before["current_workspace_id"]
    assert client.get("/search", headers=actor[1]).json()["data"]["scope"][
        "current_workspace_id"
    ] == str(second.id)


@pytest.mark.parametrize("failure", ["workspace", "membership"])
def test_legacy_fallback_and_refresh_work_with_another_active_membership_without_persisting_it(
    client, actor, failure
):
    second, _ = make_workspace(client, actor)
    original_id = UUID(actor[0]["workspace"]["id"])
    if failure == "workspace":
        changed(client, Workspace, original_id, status="archived")
    else:
        member_id = UUID(
            client.get("/workspace/members", headers=actor[1]).json()["data"]["items"][
                0
            ]["id"]
        )
        changed(client, WorkspaceMember, member_id, status="removed")
    response = client.get("/notebooks", headers=actor[1])
    assert response.status_code == 200, response.text
    assert client.get("/users/me", headers=actor[1]).json()["data"][
        "current_workspace_id"
    ] == str(original_id)
    assert (
        client.get("/notebooks", headers=context(actor, original_id)).status_code == 403
    )
    assert (
        client.get("/notebooks", headers=context(actor, second.id)).status_code == 200
    )
    assert (
        client.post(
            "/auth/refresh", json={"refresh_token": actor[0]["refresh_token"]}
        ).status_code
        == 200
    )
    logged_in = client.post(
        "/auth/login",
        json={"email": "owner@example.com", "password": "search integration password"},
    )
    assert logged_in.status_code == 200, logged_in.text
    assert logged_in.json()["data"]["workspace"]["id"] == str(second.id)
    assert logged_in.json()["data"]["user"]["current_workspace_id"] == str(original_id)


def test_global_auth_profile_and_public_routes_ignore_unrelated_context_headers(
    client, actor
):
    second, _ = make_workspace(client, actor)
    for value in ["not-a-uuid", str(second.id), str(new_uuidv7())]:
        headers = {"X-Workspace-ID": value}
        login = client.post(
            "/auth/login",
            headers=headers,
            json={
                "email": "owner@example.com",
                "password": "search integration password",
            },
        )
        assert login.status_code == 200, login.text
        assert login.json()["data"]["workspace"]["id"] == actor[0]["workspace"]["id"]
        assert (
            client.post(
                "/auth/refresh",
                headers=headers,
                json={"refresh_token": actor[0]["refresh_token"]},
            ).status_code
            == 200
        )
        assert (
            client.get("/users/me", headers={**actor[1], **headers}).status_code == 200
        )
        public = client.get("/public/sites/not-published/manifest", headers=headers)
        assert public.status_code == 404
        assert public.json()["code"] == "SITE_NOT_FOUND"
