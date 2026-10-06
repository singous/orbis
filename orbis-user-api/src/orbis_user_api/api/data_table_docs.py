"""Chinese contracts for table commands, bounded reads and public snapshots."""

PARAMETERS = {
    "note_id": "归属文档 UUID；同时验证文档所在空间和访问权限。",
    "table_id": "多维表格 UUID；必须由路径中的文档活动块引用。",
    "view_id": "待查询或导出的视图 UUID；省略时使用默认视图。",
    "expected_revision": "期望的表格版本；与当前引用不一致时返回 409。",
    "offset": "零起始的记录偏移；只分页记录，不分页字段定义。",
    "limit": "每页记录数，范围 1 至 200；默认值见字段定义。",
    "group": "单选选项 UUID；__empty__ 表示未分组。只读取当前筛选范围内该分组。",
    "format": "导出格式：csv 或 markdown，输出所选视图的完整记录。",
    "token": "实时分享凭据；撤销分享或离开授权文档范围后不可访问。",
    "snapshot_id": "公开投影快照 UUID；公开请求必须属于站点当前活动发布版本。",
    "slug": "公开站点标识；站点下线后其快照分页同时失效。",
    "expected_release_id": "期望的活动发布 UUID；发布切换后返回 409，避免混合两个版本。",
}
FIELDS = {
    "snapshot_id": "不可变公开表格快照 UUID；匿名读取同时受活动站点发布范围约束。",
    "release_id": "当前活动站点发布 UUID；内部预览读取时可为空。",
    "columns": "按视图显示顺序排列的公开字段名称。",
    "rows": "当前页已经格式化的单元格文本；不包含未授权字段。",
    "view": "冻结的发布视图名称。",
    "id": "应用生成的稳定 UUID，默认 UUIDv7；重命名不改变标识。",
    "name": "显示名称。",
    "label": "选项显示文字；记录保存选项 ID，不保存此文字。",
    "color": "选项展示颜色。",
    "kind": "字段或视图类型，允许值见枚举。",
    "options": "单选或多选选项定义；其他字段类型为空数组。",
    "field_id": "筛选或排序所使用的稳定字段 UUID。",
    "operator": "筛选运算符；同一视图内的多个筛选使用 AND 组合。",
    "value": "类型化筛选值；日期时间使用毫秒 Unix 时间戳。",
    "descending": "是否降序；最终以记录 ID 排序保证分页顺序稳定。",
    "field_ids": "按展示顺序排列的字段 UUID。",
    "widths": "以字段 UUID 为键的列宽，单位像素，范围 100 至 600。",
    "filters": "视图筛选条件，作用于完整数据集。",
    "sorts": "按优先级排列的排序条件，作用于完整数据集。",
    "group_field_id": "单层分组所使用的单选字段 UUID；null 表示不分组。",
    "title": "多维表格标题。",
    "fields": "字段定义；字段 ID 与选项 ID 保持稳定。",
    "views": "持久化视图定义，表格与看板共享同一组记录。",
    "public_view_id": "公开投影使用的视图 UUID；匿名请求不能通过参数切换为其他视图。",
    "public_field_ids": "允许出现在实时分享和站点发布数据中的字段 UUID。",
    "operation_id": "操作幂等 UUID；重试必须使用相同标识和相同请求内容。",
    "expected_document_version": "期望的归属文档版本；与表格版本共同检查，冲突返回 409。",
    "expected_table_revision": "期望的表格引用版本；冲突不会覆盖服务端记录。",
    "block_id": "文档中已保存的 dataTable 块 ID。",
    "source_table_id": "可选的复制来源表格 UUID；独立校验来源文档访问权限。",
    "source_revision": "可选的来源表格快照版本。",
    "values": "以稳定字段 UUID 为键的值对象。数字、布尔、选项 ID、多选 ID 数组和 null 按字段类型校验；日期时间单位为毫秒 Unix 时间戳，显示默认 UTC+8。",
    "definition": "字段、视图和公开策略的完整定义；省略表示只修改记录。",
    "upserts": "待新增或局部更新的记录，最多 100 条；值对象中未提供的字段保持不变。",
    "deletes": "待删除记录 UUID，最多 100 条；历史版本保留原记录。",
    "content_version": "此次读取或原子提交对应的文档版本。",
    "table_revision": "此次原子提交得到的不可变表格版本引用。",
    "table_id": "归属文档中的多维表格 UUID。",
    "block": "服务器保存后的完整表格块，可用于更新编辑器基线。",
    "inverse": "用于撤销本次修改的补偿变更；执行时仍需提供新的操作 ID 和期望版本。",
    "revision": "本次记录页对应的表格版本。",
    "view_id": "实际使用的视图 UUID。",
    "records": "当前页记录；字段值始终使用稳定字段 ID。",
    "total": "筛选及可选分组后的完整记录数，不是当前页数量。",
    "offset": "当前页的零起始记录偏移。",
    "next_offset": "下一页起始偏移。",
    "has_more": "当前筛选范围是否还有后续记录。",
    "groups": "完整筛选范围内的分组名称、选项 ID 及记录数。",
}
SCHEMAS = {
    "PublishedTablePage",
    "SelectOption",
    "TableField",
    "TableFilter",
    "TableSort",
    "TableView",
    "TableDefinition",
    "TableCreate",
    "RecordUpsert",
    "TableMutation",
    "TableMutationOut",
    "TablePage",
}


def install_data_table_docs(schema, operation_description, add_error):
    for name in SCHEMAS:
        for field, rule in (
            schema["components"]["schemas"].get(name, {}).get("properties", {}).items()
        ):
            rule["description"] = FIELDS.get(field, "多维表格业务字段。")
    for path, methods in schema["paths"].items():
        if not ("/tables" in path or "/table-snapshots/" in path):
            continue
        for method, operation in methods.items():
            if not isinstance(operation, dict) or "responses" not in operation:
                continue
            description = (
                operation.get("summary", "多维表格操作")
                + "。表格继承文档权限；字段、记录和视图变更与文档版本原子提交。公开读取仅包含服务端允许的字段。"
            )
            operation["description"] = operation_description(method, path, description)
            if path.startswith("/public/"):
                operation["description"] = operation["description"].replace(
                    "必须在 Authorization 请求头中携带 `Bearer <access_token>`；部分写操作还要求资源管理权限。",
                    "匿名读取；实时分享凭据或站点活动发布版本必须有效。",
                )
            if method == "get" and not path.endswith(
                ("/export", "/export-text", "/html")
            ):
                operation["description"] = operation["description"].replace(
                    "本接口不使用分页；业务结果直接位于 `data`。",
                    "使用 offset/limit 分页。记录位于 data.records，发布快照单元格位于 data.rows；data.total 为完整匹配数，data.next_offset 与 data.has_more 指示后续读取。",
                )
            if path.endswith("/export") or path.endswith("/html"):
                access = (
                    "匿名访问，受活动发布版本约束。"
                    if path.startswith("/public/")
                    else "需要 Bearer 身份认证及归属文档读取权限。"
                )
                operation["description"] = (
                    description
                    + "\n\n"
                    + access
                    + "\n\n响应格式：成功返回原始 CSV、Markdown 或 HTML 文本；失败返回统一 JSON，包含 code、message、request_id 与 data。"
                )
            for parameter in operation.get("parameters", []):
                parameter["description"] = PARAMETERS.get(
                    parameter["name"], parameter.get("description", "请求参数。")
                )
            for code, status, text in [
                ("DATA_TABLE_NOT_FOUND", 404, "表格不存在或无权访问"),
                ("DATA_TABLE_INVALID", 422, "字段值、视图或请求内容无效"),
                ("NOTE_VERSION_CONFLICT", 409, "文档或表格版本冲突，本机修改仍保留"),
            ]:
                add_error(operation, status, code, text)
    schema["components"]["schemas"]["NoteBlockChangesOut"]["properties"][
        "table_blocks"
    ][
        "description"
    ] = "复制表格后由服务器重写的块引用；其他块变更时为空数组。客户端应合并这些引用到已保存与当前基线。"
