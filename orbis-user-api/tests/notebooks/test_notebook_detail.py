from uuid import UUID

import pytest

from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.note import Notebook, NoteGroup


def test_notebook_detail_does_not_depend_on_list_pagination(client, actor):
    headers = actor[1]
    response = client.post("/notebooks", headers=headers, json={"title": "Details"})
    assert response.status_code == 201, response.text
    notebook = response.json()["data"]
    detail = client.get(f"/notebooks/{notebook['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["data"] == notebook
    assert client.get(f"/notebooks/{new_uuidv7()}", headers=headers).status_code == 404
    assert client.get(f"/notebooks/{notebook['id']}").status_code == 401


@pytest.mark.parametrize("inactive", ["notebook", "group", "cross_workspace"])
def test_notebook_detail_rejects_inactive_or_foreign_parent(client, actor, inactive):
    response = client.post("/notebooks", headers=actor[1], json={"title": "Details"})
    notebook = response.json()["data"]

    async def change():
        async with client.app.state.session_factory() as session:
            if inactive == "notebook":
                row = await session.get(Notebook, UUID(notebook["id"]))
                row.status = "archived"
            else:
                row = await session.get(NoteGroup, UUID(notebook["group_id"]))
                if inactive == "group":
                    row.status = "archived"
                else:
                    row.workspace_id = new_uuidv7()
            await session.commit()

    client.portal.call(change)
    detail = client.get(f"/notebooks/{notebook['id']}", headers=actor[1])
    assert detail.status_code == 404 and detail.json()["code"] == "NOTEBOOK_NOT_FOUND"
