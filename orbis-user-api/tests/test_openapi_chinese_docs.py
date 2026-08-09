from __future__ import annotations

import re


def _operations(schema: dict[str, object]):
    methods = {"get", "post", "put", "patch", "delete"}
    paths = schema["paths"]
    assert isinstance(paths, dict)
    for path, path_item in paths.items():
        assert isinstance(path_item, dict)
        for method, operation in path_item.items():
            if method in methods:
                assert isinstance(operation, dict)
                yield method, path, operation


def test_every_operation_has_detailed_chinese_documentation() -> None:
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    operations = list(_operations(schema))

    assert len(operations) == 42
    for method, path, operation in operations:
        summary = operation.get("summary", "")
        description = operation.get("description", "")
        assert re.search(r"[\u4e00-\u9fff]", summary), (method, path, summary)
        assert re.search(r"[\u4e00-\u9fff]", description), (method, path, description)
        assert "响应格式" in description, (method, path)
        assert "request_id" in description, (method, path)


def test_every_operation_uses_a_chinese_business_folder() -> None:
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    expected_tags = {
        "系统初始化",
        "身份认证",
        "用户资料",
        "工作空间",
        "所有权转让",
        "文档分组",
        "文集",
        "文档",
        "文件",
        "系统状态",
    }

    assert {tag["name"] for tag in schema["tags"]} == expected_tags
    for method, path, operation in _operations(schema):
        assert len(operation["tags"]) == 1, (method, path, operation["tags"])
        tag = operation["tags"][0]
        assert tag in expected_tags, (method, path, tag)
        assert re.search(r"[\u4e00-\u9fff]", tag), (method, path, tag)


def test_common_envelope_and_request_fields_have_chinese_descriptions() -> None:
    from orbis_user_api.main import create_app

    components = create_app().openapi()["components"]["schemas"]
    api_responses = [
        component
        for name, component in components.items()
        if name.startswith("ApiResponse")
    ]
    assert api_responses
    for response_schema in api_responses:
        for field_name in ("code", "message", "request_id", "data"):
            description = response_schema["properties"][field_name]["description"]
            assert re.search(r"[\u4e00-\u9fff]", description)

    login_request = components["LoginRequest"]
    assert "邮箱" in login_request["properties"]["email"]["description"]
    assert "密码" in login_request["properties"]["password"]["description"]
    assert login_request["example"]["email"] == "owner@example.com"


def test_pagination_and_business_error_examples_are_documented() -> None:
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    list_operation = schema["paths"]["/notes"]["get"]
    parameters = {item["name"]: item for item in list_operation["parameters"]}
    assert "页码" in parameters["page"]["description"]
    assert "每页" in parameters["page_size"]["description"]
    success_example = list_operation["responses"]["200"]["content"][
        "application/json"
    ]["examples"]["success"]["value"]
    assert success_example["data"]["pagination"]["page"] == 1

    save_operation = schema["paths"]["/notes/{note_id}/content"]["put"]
    conflict_example = save_operation["responses"]["409"]["content"][
        "application/json"
    ]["examples"]["NOTE_VERSION_CONFLICT"]["value"]
    assert conflict_example["code"] == "NOTE_VERSION_CONFLICT"
    assert conflict_example["data"] is None

    delete_operation = schema["paths"]["/workspace/members/{member_id}"]["delete"]
    delete_example = delete_operation["responses"]["200"]["content"][
        "application/json"
    ]["examples"]["success"]["value"]
    assert delete_example["data"] is None


def test_documented_errors_use_the_real_unified_error_schema() -> None:
    from orbis_user_api.main import create_app

    schema = create_app().openapi()
    for method, path, operation in _operations(schema):
        for status_code, response in operation["responses"].items():
            if int(status_code) < 400 or "content" not in response:
                continue
            json_schema = response["content"]["application/json"]["schema"]
            assert json_schema == {
                "$ref": "#/components/schemas/ApiErrorResponse"
            }, (method, path, status_code, json_schema)

    archive_operation = schema["paths"][
        "/document-groups/{group_id}/archive"
    ]["post"]
    assert {"401", "403", "404", "409", "422", "500"}.issubset(
        archive_operation["responses"]
    )
