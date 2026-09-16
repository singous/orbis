from __future__ import annotations

import re

import pytest

from orbis_user_api.api import collaboration, sites
from orbis_user_api.application.site_content import public_note_blocks
from orbis_user_api.domain.note_content import derive_plain_text
from orbis_user_api.main import create_app

EXPECTED_OPERATIONS = {
    ("get", "/sites"),
    ("post", "/sites"),
    ("get", "/sites/{site_id}"),
    ("put", "/sites/{site_id}"),
    ("get", "/sites/{site_id}/preview"),
    ("get", "/sites/{site_id}/sources"),
    ("post", "/sites/{site_id}/publish"),
    ("get", "/sites/{site_id}/releases"),
    ("post", "/sites/{site_id}/releases/{release_id}/activate"),
    ("post", "/sites/{site_id}/unpublish"),
    ("get", "/public/sites/{slug}"),
    ("get", "/notes/{note_id}/comments"),
    ("post", "/notes/{note_id}/comments"),
    ("patch", "/notes/{note_id}/comments/{comment_id}"),
    ("get", "/notes/{note_id}/revisions"),
    ("get", "/notes/{note_id}/revisions/{revision_id}"),
    ("post", "/notes/{note_id}/revisions/{revision_id}/restore"),
}
ROUTES = [
    route
    for router in (sites.router, sites.public_router, collaboration.router)
    for route in router.routes
]


@pytest.fixture(scope="module")
def schema():
    return create_app().openapi()


def _success_example(operation, status_code=200):
    return operation["responses"][str(status_code)]["content"]["application/json"][
        "examples"
    ]["success"]["value"]


def test_base_mvp_documentation_covers_the_registered_contract(schema):
    actual = {
        (method.lower(), route.path) for route in ROUTES for method in route.methods
    }
    assert actual == EXPECTED_OPERATIONS
    for method, path in actual:
        operation = schema["paths"][path][method]
        assert "响应格式" in operation["description"]
        for parameter in operation.get("parameters", []):
            assert re.search(r"[\u4e00-\u9fff]", parameter["description"])


@pytest.mark.parametrize("route", ROUTES, ids=lambda route: route.unique_id)
def test_success_examples_validate_against_actual_response_models(schema, route):
    method = next(iter(route.methods)).lower()
    operation = schema["paths"][route.path][method]
    status_code = route.status_code or 200
    example = _success_example(operation, status_code)
    assert example["code"] == ("CREATED" if status_code == 201 else "OK")
    assert example["data"]
    assert (
        route.response_model.model_validate(example).model_dump(mode="json") == example
    )
    if "pagination" in example["data"]:
        assert example["data"]["items"]
        assert example["data"]["pagination"]["total"] >= len(example["data"]["items"])
        assert "data.pagination" in operation["description"]
        parameters = {item["name"]: item for item in operation["parameters"]}
        assert parameters["page"]["schema"]["default"] == 1
        assert parameters["page_size"]["schema"]["default"] == 20
        assert parameters["page_size"]["schema"]["maximum"] == 100


@pytest.mark.parametrize(
    "route",
    [route for route in ROUTES if route.body_field],
    ids=lambda route: route.unique_id,
)
def test_request_examples_validate_against_actual_request_models(schema, route):
    method = next(iter(route.methods)).lower()
    operation = schema["paths"][route.path][method]
    examples = operation["requestBody"]["content"]["application/json"]["examples"]
    assert examples
    for example in examples.values():
        value = example["value"]
        assert value
        route.body_field.field_info.annotation.model_validate(value)


def test_only_public_reader_is_anonymous_and_creation_uses_201(schema):
    for method, path in EXPECTED_OPERATIONS:
        operation = schema["paths"][path][method]
        if path == "/public/sites/{slug}":
            assert not operation.get("security")
            assert "401" not in operation["responses"]
            assert "403" not in operation["responses"]
            assert "匿名" in operation["description"]
        else:
            assert operation["security"] == [{"OAuth2PasswordBearer": []}]
            assert "401" in operation["responses"]
    for path in ("/sites", "/notes/{note_id}/comments"):
        responses = schema["paths"][path]["post"]["responses"]
        assert "201" in responses
        assert "200" not in responses


def test_public_and_preview_examples_reflect_snapshot_boundaries(schema):
    public = _success_example(schema["paths"]["/public/sites/{slug}"]["get"])["data"]
    preview = _success_example(schema["paths"]["/sites/{site_id}/preview"]["get"])[
        "data"
    ]
    for key in ("release_id", "release_number", "published_at_ms"):
        assert public[key] is not None
        assert preview[key] is None
    for snapshot in (public, preview):
        assert snapshot["pages"]
        for item in (snapshot, *snapshot["pages"]):
            assert {"note_id", "workspace_id", "author_id", "owner_id"}.isdisjoint(item)
        for page in snapshot["pages"]:
            assert page["blocks"] == public_note_blocks(page["blocks"])
            assert page["plain_text"] == derive_plain_text(page["blocks"])
    unpublished = _success_example(
        schema["paths"]["/sites/{site_id}/unpublish"]["post"]
    )["data"]
    assert unpublished["published_release_id"] is None
    assert unpublished["published_slug"] is None


def test_new_schema_fields_have_contextual_chinese_descriptions(schema):
    components = schema["components"]["schemas"]
    names = (
        "SiteCreateRequest",
        "SiteUpdateRequest",
        "SiteNavigationItem",
        "SiteOut",
        "SitePageOut",
        "SiteSnapshotOut",
        "SiteReleaseOut",
        "CommentCreateRequest",
        "CommentUpdateRequest",
        "CommentOut",
        "RevisionSummary",
        "RevisionOut",
        "RevisionRestoreRequest",
    )
    for name in names:
        for field, definition in components[name]["properties"].items():
            assert re.search(r"[\u4e00-\u9fff]", definition.get("description", "")), (
                name,
                field,
            )
    assert "评论" in components["CommentOut"]["properties"]["parent_id"]["description"]
    assert (
        "配置"
        in components["SiteUpdateRequest"]["properties"]["expected_version"][
            "description"
        ]
    )


@pytest.mark.parametrize(
    ("method", "path", "status", "codes"),
    [
        ("post", "/sites", "409", {"SITE_SLUG_CONFLICT"}),
        (
            "put",
            "/sites/{site_id}",
            "409",
            {"SITE_SLUG_CONFLICT", "SITE_VERSION_CONFLICT"},
        ),
        (
            "post",
            "/sites/{site_id}/publish",
            "422",
            {"SITE_EMPTY", "SITE_DOCUMENT_INVALID", "SITE_CONTENT_UNSAFE"},
        ),
        ("post", "/sites/{site_id}/publish", "403", {"SITE_PUBLISH_FORBIDDEN"}),
        ("get", "/public/sites/{slug}", "404", {"SITE_NOT_FOUND"}),
        (
            "post",
            "/sites/{site_id}/releases/{release_id}/activate",
            "404",
            {"SITE_NOT_FOUND", "SITE_RELEASE_NOT_FOUND"},
        ),
        (
            "post",
            "/notes/{note_id}/comments",
            "404",
            {"NOTE_NOT_FOUND", "COMMENT_NOT_FOUND"},
        ),
        (
            "patch",
            "/notes/{note_id}/comments/{comment_id}",
            "403",
            {"COLLABORATION_FORBIDDEN"},
        ),
        (
            "post",
            "/notes/{note_id}/revisions/{revision_id}/restore",
            "409",
            {"NOTE_VERSION_CONFLICT"},
        ),
        (
            "post",
            "/notes/{note_id}/revisions/{revision_id}/restore",
            "404",
            {"NOTE_NOT_FOUND", "REVISION_NOT_FOUND"},
        ),
    ],
)
def test_important_business_errors_are_documented(schema, method, path, status, codes):
    examples = schema["paths"][path][method]["responses"][status]["content"][
        "application/json"
    ]["examples"]
    assert codes <= examples.keys()
    for code in codes:
        assert examples[code]["value"]["code"] == code
        assert examples[code]["value"]["data"] is None
