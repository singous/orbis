from __future__ import annotations

from uuid import UUID

import pytest

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.collaboration import NoteComment, NoteRevision
from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.note import Note, Notebook, NoteContent, NoteGroup
from orbis_user_api.models.site import Site
from orbis_user_api.models.workspace import Workspace, WorkspaceMember


def persist(client, *objects):
    async def add():
        async with client.app.state.session_factory() as session:
            session.add_all(objects)
            await session.commit()

    client.portal.call(add)


def mutate(client, model, identifier, **changes):
    async def update():
        async with client.app.state.session_factory() as session:
            row = await session.get(model, identifier)
            for key, value in changes.items():
                setattr(row, key, value)
            await session.commit()

    client.portal.call(update)


def resources(actor, *, workspace_id=None, name="目录"):
    data, _ = actor
    owner_id = UUID(data["user"]["id"])
    workspace_id = workspace_id or UUID(data["workspace"]["id"])
    group = NoteGroup(
        id=new_uuidv7(), workspace_id=workspace_id, owner_id=owner_id, name=name
    )
    notebook = Notebook(
        id=new_uuidv7(),
        workspace_id=workspace_id,
        owner_id=owner_id,
        group_id=group.id,
        title=name,
    )
    return group, notebook


def document(actor, notebook, title="文档", body="", **kwargs):
    note = Note(
        id=new_uuidv7(),
        workspace_id=notebook.workspace_id,
        owner_id=UUID(actor[0]["user"]["id"]),
        notebook_id=notebook.id,
        title=title,
        **kwargs,
    )
    content = NoteContent(id=new_uuidv7(), note_id=note.id, blocks={}, plain_text=body)
    return note, content


def search(client, actor, q="needle", **params):
    response = client.get("/search", headers=actor[1], params={"q": q, **params})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def add_workspace(
    client,
    actor,
    name,
    *,
    role="normal",
    member_status="active",
    status="active",
    join=True,
):
    owner_id = UUID(actor[0]["user"]["id"])
    workspace = Workspace(id=new_uuidv7(), owner_id=owner_id, name=name, status=status)
    membership = WorkspaceMember(
        id=new_uuidv7(),
        workspace_id=workspace.id,
        user_id=owner_id,
        role=role,
        status=member_status,
    )
    persist(client, workspace, *([membership] if join else []))
    return workspace, membership


def test_cross_type_search_deduplicates_current_comments_and_reads_shared_files(
    client, actor
):
    group, notebook = resources(actor, name="needle")
    note, content = document(actor, notebook, "Architecture")
    comments = [
        NoteComment(
            id=new_uuidv7(),
            workspace_id=note.workspace_id,
            note_id=note.id,
            author_id=note.owner_id,
            body="needle comment",
            is_resolved=resolved,
        )
        for resolved in (False, True)
    ]
    site = Site(
        id=new_uuidv7(),
        workspace_id=note.workspace_id,
        name="Portal",
        slug="needle-portal",
    )
    file = FileAsset(
        id=new_uuidv7(),
        workspace_id=note.workspace_id,
        owner_id=new_uuidv7(),
        storage_key="private/key",
        original_filename="needle.pdf",
        mime_type="application/pdf",
        file_size=123,
        sha256="a" * 64,
    )
    persist(client, group, notebook, note, content, *comments, site, file)
    data = search(client, actor)
    assert data["pagination"]["total"] == 5
    assert {item["type"] for item in data["items"]} == {
        "document",
        "notebook",
        "group",
        "site",
        "file",
    }
    result = next(item for item in data["items"] if item["type"] == "document")
    assert result["id"] == str(note.id) and result["match"] == "comment"
    assert result["matched_comment_id"] in {str(comment.id) for comment in comments}
    assert result["location"] == "needle / needle"
    assert search(client, actor, type="file")["items"][0]["id"] == str(file.id)
    serialized = str(data)
    assert (
        "private/key" not in serialized
        and "sha256" not in serialized
        and "blocks" not in serialized
    )
    assert search(client, actor, q="application/pdf")["items"][0]["match"] == "metadata"


def test_body_snippet_is_bounded_around_late_match_and_history_is_not_searched(
    client, actor
):
    group, notebook = resources(actor)
    note, content = document(
        actor, notebook, body="开始 " * 1000 + "needle target " + "结束 " * 1000
    )
    revision = NoteRevision(
        id=new_uuidv7(),
        workspace_id=note.workspace_id,
        note_id=note.id,
        author_id=note.owner_id,
        content_version=1,
        plain_text="historical-only",
        blocks={},
    )
    persist(client, group, notebook, note, content, revision)
    result = search(client, actor)["items"][0]
    assert result["match"] == "body" and result["matched_comment_id"] is None
    assert "needle" in result["snippet"] and len(result["snippet"]) <= 240
    assert result["snippet"].startswith("…") and result["snippet"].endswith("…")
    assert search(client, actor, q="historical-only")["pagination"]["total"] == 0


def test_scope_defaults_to_current_and_explicit_scopes_never_switch_current_workspace(
    client, actor
):
    second, _ = add_workspace(client, actor, "Second")
    hidden, _ = add_workspace(client, actor, "Hidden", join=False)
    first_group, first_book = resources(actor, name="needle first")
    second_group, second_book = resources(
        actor, workspace_id=second.id, name="needle second"
    )
    hidden_group, hidden_book = resources(
        actor, workspace_id=hidden.id, name="needle hidden"
    )
    persist(
        client,
        first_group,
        first_book,
        second_group,
        second_book,
        hidden_group,
        hidden_book,
    )
    initial = actor[0]["workspace"]["id"]
    default = search(client, actor)
    assert {item["workspace_id"] for item in default["items"]} == {initial}
    expanded = search(client, actor, scope="all")
    assert expanded["pagination"]["total"] == 4
    assert {item["workspace_id"] for item in expanded["items"]} == {
        initial,
        str(second.id),
    }
    selected = search(client, actor, workspace_id=str(second.id))
    assert {item["workspace_id"] for item in selected["items"]} == {str(second.id)}
    assert (
        client.get("/users/me", headers=actor[1]).json()["data"]["current_workspace_id"]
        == initial
    )
    discovery = search(client, actor, q="   ")
    assert discovery["items"] == [] and discovery["pagination"]["total"] == 0
    assert {workspace["id"] for workspace in discovery["workspaces"]} == {
        initial,
        str(second.id),
    }


@pytest.mark.parametrize("change", ["revoked", "role", "workspace"])
def test_permissions_revalidated_after_membership_or_workspace_changes(
    client, actor, change
):
    second, member = add_workspace(client, actor, "Second")
    group, notebook = resources(actor, workspace_id=second.id, name="needle")
    persist(client, group, notebook)
    assert (
        search(client, actor, workspace_id=str(second.id))["pagination"]["total"] == 2
    )
    if change == "revoked":
        mutate(client, WorkspaceMember, member.id, status="removed")
    elif change == "role":
        mutate(client, WorkspaceMember, member.id, role="unknown-role")
    else:
        mutate(client, Workspace, second.id, status="archived")
    response = client.get(
        "/search",
        headers=actor[1],
        params={"q": "needle", "workspace_id": str(second.id)},
    )
    assert (
        response.status_code == 403
        and response.json()["code"] == "SEARCH_WORKSPACE_FORBIDDEN"
    )
    assert search(client, actor, scope="all")["pagination"]["total"] == 0


def test_current_membership_failure_does_not_silently_choose_another_workspace(
    client, actor
):
    second, _ = add_workspace(client, actor, "Second")
    initial = UUID(actor[0]["workspace"]["id"])
    mutate(client, Workspace, initial, status="archived")
    response = client.get("/search", headers=actor[1], params={"q": "needle"})
    assert response.status_code == 403
    user = client.get("/users/me", headers=actor[1]).json()["data"]
    assert user["current_workspace_id"] == str(initial)
    assert search(client, actor, scope="all")["scope"]["workspace_ids"] == [
        str(second.id)
    ]


def test_active_search_honors_full_ancestor_paths_and_archived_filter(client, actor):
    group, notebook = resources(actor)
    root, root_content = document(actor, notebook, "needle root", status="archived")
    child, child_content = document(
        actor, notebook, "needle hidden child", parent_id=root.id
    )
    orphan, orphan_content = document(
        actor, notebook, "needle orphan", parent_id=new_uuidv7()
    )
    active, active_content = document(actor, notebook, "needle active")
    hidden_comment = NoteComment(
        id=new_uuidv7(),
        workspace_id=child.workspace_id,
        note_id=child.id,
        author_id=child.owner_id,
        body="comment-only",
    )
    archived_comment = NoteComment(
        id=new_uuidv7(),
        workspace_id=root.workspace_id,
        note_id=root.id,
        author_id=root.owner_id,
        body="archived-comment-only",
    )
    persist(
        client,
        group,
        notebook,
        root,
        root_content,
        child,
        child_content,
        orphan,
        orphan_content,
        active,
        active_content,
        hidden_comment,
        archived_comment,
    )
    assert [item["id"] for item in search(client, actor)["items"]] == [str(active.id)]
    archived = search(client, actor, status="archived")
    assert [item["id"] for item in archived["items"]] == [str(root.id)]
    assert {item["id"] for item in search(client, actor, status="all")["items"]} == {
        str(root.id),
        str(active.id),
    }
    assert search(client, actor, q="comment-only", status="all")["items"] == []
    mutate(client, Notebook, notebook.id, status="archived")
    assert search(client, actor)["items"] == []
    mutate(client, Notebook, notebook.id, status="active")
    mutate(client, NoteGroup, group.id, status="archived")
    assert search(client, actor)["items"] == []


def test_foreign_comment_and_invalid_parent_workspace_cannot_leak(client, actor):
    group, notebook = resources(actor)
    note, content = document(actor, notebook)
    foreign = NoteComment(
        id=new_uuidv7(),
        workspace_id=new_uuidv7(),
        note_id=note.id,
        author_id=note.owner_id,
        body="needle secret",
    )
    persist(client, group, notebook, note, content, foreign)
    assert search(client, actor)["items"] == []
    mutate(client, NoteGroup, group.id, workspace_id=new_uuidv7())
    assert search(client, actor, q="文档", type="document")["items"] == []


def test_pending_files_and_archived_asset_filters_do_not_return_results(client, actor):
    workspace_id = UUID(actor[0]["workspace"]["id"])
    site = Site(
        id=new_uuidv7(), workspace_id=workspace_id, name="needle", slug="needle"
    )
    file = FileAsset(
        id=new_uuidv7(),
        workspace_id=workspace_id,
        owner_id=new_uuidv7(),
        storage_key="unfinished/key",
        original_filename="needle.pdf",
        mime_type="application/pdf",
        file_size=0,
        sha256="b" * 64,
        upload_status="pending",
    )
    persist(client, site, file)
    assert search(client, actor, type="file")["items"] == []
    assert search(client, actor, status="archived")["items"] == []


def test_pagination_has_true_total_stable_order_and_no_hundred_item_cutoff(
    client, actor
):
    group, notebook = resources(actor)
    pairs = [
        document(actor, notebook, f"needle {index:03}", updated_at_ms=1)
        for index in range(105)
    ]
    exact, exact_content = document(actor, notebook, "needle", updated_at_ms=0)
    body, body_content = document(
        actor, notebook, "Recently changed", "needle", updated_at_ms=999999
    )
    persist(
        client,
        group,
        notebook,
        *(row for pair in pairs for row in pair),
        exact,
        exact_content,
        body,
        body_content,
    )
    first = search(client, actor, page_size=100)
    last = search(client, actor, page_size=100, page=2)
    assert first["pagination"]["total"] == last["pagination"]["total"] == 107
    assert first["pagination"]["has_next"] and not last["pagination"]["has_next"]
    assert first["items"][0]["id"] == str(exact.id)
    assert last["items"][-1]["id"] == str(body.id)
    ids = [item["id"] for item in first["items"] + last["items"]]
    assert len(ids) == len(set(ids)) == 107
    assert search(client, actor, page_size=100)["items"] == first["items"]


@pytest.mark.parametrize(
    "query", ["100%", "under_score", r"back\slash", "路径/入口", "知识检索"]
)
def test_query_is_plain_literal_text_including_sql_wildcards_and_unicode(
    client, actor, query
):
    group, notebook = resources(actor)
    exact = document(actor, notebook, query)
    near = document(
        actor, notebook, "100 percent underXscore backslash 路径其他 知识记录"
    )
    persist(client, group, notebook, *exact, *near)
    assert [item["id"] for item in search(client, actor, q=query)["items"]] == [
        str(exact[0].id)
    ]


def test_explicit_switch_validates_permissions_and_is_idempotent(client, actor):
    second, member = add_workspace(client, actor, "Second", role="normal")
    hidden, _ = add_workspace(client, actor, "Hidden", join=False)
    initial = actor[0]["workspace"]["id"]
    denied = client.post(
        "/workspace/switch", headers=actor[1], json={"workspace_id": str(hidden.id)}
    )
    assert denied.status_code == 403
    assert (
        client.get("/users/me", headers=actor[1]).json()["data"]["current_workspace_id"]
        == initial
    )
    result = client.post(
        "/workspace/switch", headers=actor[1], json={"workspace_id": str(second.id)}
    )
    assert result.status_code == 200, result.text
    data = result.json()["data"]
    assert data["user"]["current_workspace_id"] == str(second.id)
    assert (
        data["workspace"]["role"] == "normal"
        and data["workspace"]["is_current"] is True
    )
    repeated = client.post(
        "/workspace/switch", headers=actor[1], json={"workspace_id": str(second.id)}
    )
    assert repeated.json()["data"] == data
    mutate(client, WorkspaceMember, member.id, status="removed")
    assert (
        client.post(
            "/workspace/switch", headers=actor[1], json={"workspace_id": str(second.id)}
        ).status_code
        == 403
    )


def test_request_validation_and_authentication(client, actor):
    assert client.get("/search", params={"q": "needle"}).status_code == 401
    for params in (
        {"type": "comment"},
        {"status": "deleted"},
        {"page_size": 101},
        {"q": "x" * 241},
        {"scope": "all", "workspace_id": actor[0]["workspace"]["id"]},
    ):
        assert client.get("/search", headers=actor[1], params=params).status_code == 422
    assert (
        client.get(
            "/search", headers=actor[1], params={"workspace_id": str(new_uuidv7())}
        ).status_code
        == 403
    )


def test_search_openapi_documents_actual_contract_and_switch_session_scope(client):
    schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/search"]["get"]
    params = {item["name"] for item in operation["parameters"]}
    assert {
        "q",
        "scope",
        "workspace_id",
        "type",
        "resource_id",
        "status",
        "page",
        "page_size",
    } <= params
    assert "SEARCH_WORKSPACE_FORBIDDEN" in str(operation["responses"]["403"])
    assert "其他会话" in schema["paths"]["/workspace/switch"]["post"]["description"]


def test_archived_id_lookup_finds_target_beyond_first_hundred_before_pagination(
    client, actor
):
    group, notebook = resources(actor)
    pairs = [
        document(
            actor,
            notebook,
            f"archived {index:03}",
            status="archived",
            updated_at_ms=index,
        )
        for index in range(105)
    ]
    persist(client, group, notebook, *(row for pair in pairs for row in pair))
    target = pairs[0][0]
    first = search(
        client, actor, q="archived", type="document", status="archived", page_size=100
    )
    assert str(target.id) not in {item["id"] for item in first["items"]}
    focused = search(
        client,
        actor,
        q="",
        type="document",
        status="archived",
        resource_id=str(target.id),
    )
    assert focused["pagination"]["total"] == 1
    assert [item["id"] for item in focused["items"]] == [str(target.id)]
    assert (
        search(client, actor, q="", type="document", resource_id=str(target.id))[
            "items"
        ]
        == []
    )


def test_id_lookup_enforces_resource_type_membership_and_exact_id(client, actor):
    hidden, _ = add_workspace(client, actor, "Hidden", join=False)
    group, notebook = resources(actor, workspace_id=hidden.id, name="secret")
    note, content = document(actor, notebook, "secret", status="archived")
    persist(client, group, notebook, note, content)
    for scope in ("current", "all"):
        result = search(
            client,
            actor,
            q="",
            scope=scope,
            type="document",
            status="archived",
            resource_id=str(note.id),
        )
        assert result["items"] == [] and result["pagination"]["total"] == 0
    result = search(client, actor, q="", type="group", resource_id=str(new_uuidv7()))
    assert result["items"] == [] and result["pagination"]["total"] == 0
    response = client.get(
        "/search", headers=actor[1], params={"resource_id": str(note.id)}
    )
    assert (
        response.status_code == 422
        and response.json()["code"] == "SEARCH_RESOURCE_TYPE_REQUIRED"
    )
