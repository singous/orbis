"""Chinese documentation and complete examples for sites and collaboration."""

from __future__ import annotations

from typing import Any

TAG_DOCS = {
    "sites": ("站点管理", "站点草稿配置、认证预览、不可变发布快照与版本切换"),
    "public-sites": ("公开站点", "匿名读取当前发布快照及在快照内搜索所需的公开正文"),
    "collaboration": (
        "文档协作",
        "当前工作空间活跃文档的评论、回复、历史查看与版本恢复",
    ),
}

PUBLIC_OPERATION = ("get", "/public/sites/{slug}")
PAGINATED_PATHS = {
    "/sites",
    "/sites/{site_id}/releases",
    "/notes/{note_id}/comments",
    "/notes/{note_id}/revisions",
}

OPERATION_DOCS = {
    ("get", "/sites"): (
        "分页查询站点",
        "查询当前工作空间的站点配置草稿，按更新时间、站点标识倒序排列。所有活跃成员均可读取；published_release_id 和 published_slug 表示当前公开版本。",
    ),
    ("post", "/sites"): (
        "创建站点",
        "所有者、管理员或编辑者创建站点配置草稿。slug 在所有工作空间的站点草稿和当前公开路径中唯一；navigation 可为空。所选文档必须属于当前空间且文档及其全部上级资源处于活跃状态。创建成功返回 HTTP 201，不会自动发布。",
    ),
    ("get", "/sites/{site_id}"): (
        "读取站点配置",
        "读取当前工作空间中的站点配置草稿。草稿名称、路径、导航和主题可以与当前公开版本不同；其他空间中的站点返回 SITE_NOT_FOUND。",
    ),
    ("put", "/sites/{site_id}"): (
        "保存站点完整配置",
        "所有者、管理员或编辑者以 expected_version 校验当前配置版本并完整保存配置，成功后 config_version 递增。source 和 branding 省略时保留已有值，其他可选字段省略时按默认值保存，navigation 省略时变为空数组。配置过期或保存期间发生发布时返回 SITE_VERSION_CONFLICT；草稿修改不影响当前公开快照及其路径。",
    ),
    ("get", "/sites/{site_id}/preview"): (
        "预览待发布站点",
        "当前空间成员读取由最新站点配置与当前文档正文构建的认证预览。预览会校验文档及公开内容，可以为空；release_id、release_number、published_at_ms 均为 null，不创建发布历史。响应头 Cache-Control 为 no-store。",
    ),
    ("get", "/sites/{site_id}/sources"): (
        "解析站点来源与待发布变化",
        "当前空间成员读取笔记本或手选来源的完整页面元数据、排除数量和来源指纹，比较当前公开版本得到新增、修改和移除列表。该接口需要登录，包含内部文档标识，不生成发布版本。",
    ),
    ("post", "/sites/{site_id}/publish"): (
        "发布站点不可变快照",
        "仅所有者和管理员可以发布。至少包含一篇文档；发布前校验空间归属、活跃状态、内容格式及公开链接安全性。笔记本来源必须在请求体携带认证预览返回的 expected_source_fingerprint；缺失返回 SITE_PREVIEW_REQUIRED，过期或构建期间来源变化返回 SITE_SOURCE_CONFLICT。旧手选来源仍接受空请求体。成功后生成递增版本并原子切换公开指针，响应为 HTTP 200；后续保存不会修改快照，失败时保留原公开版本。",
    ),
    ("get", "/sites/{site_id}/releases"): (
        "分页查询站点发布历史",
        "当前空间成员按发布版本号倒序查询站点发布历史。is_active 标识当前公开版本；站点撤回后全部历史版本的 is_active 均为 false。",
    ),
    ("post", "/sites/{site_id}/releases/{release_id}/activate"): (
        "切换站点公开版本",
        "仅所有者和管理员可以将本站点的已有发布快照设为当前公开版本，可用于回滚或重新公开。该操作同时恢复快照中的公开路径、主题、导航和正文，不修改配置草稿或源文档，不创建新发布版本。旧路径被其他站点占用时返回 SITE_SLUG_CONFLICT；无需请求体。",
    ),
    ("post", "/sites/{site_id}/unpublish"): (
        "撤回公开站点",
        "仅所有者和管理员可以撤回站点。成功后 published_release_id 和 published_slug 均为 null，匿名入口返回 404；配置草稿和历史发布版本保留，可再次发布或切换到历史版本。重复撤回仍成功，无需请求体。",
    ),
    PUBLIC_OPERATION: (
        "匿名读取已发布站点",
        "匿名读取 slug 对应的当前不可变发布快照。未发布、已撤回或不存在的站点统一返回 SITE_NOT_FOUND。响应包含完整公开页面，按 pages 数组顺序呈现；客户端可使用页面标题与 plain_text 在本快照内搜索，本接口没有 q 参数。响应不含内部文档、空间或作者标识，不读取草稿；Cache-Control 为 no-store。",
    ),
    ("get", "/notes/{note_id}/comments"): (
        "分页查询文档评论",
        "当前空间的所有活跃成员均可查询活跃文档的评论，按创建时间、评论标识正序排列。返回平铺列表，通过 parent_id 关联回复；不递归嵌套，也不自动隐藏已解决评论。不可访问或已归档的文档及其上级资源返回 NOTE_NOT_FOUND。",
    ),
    ("post", "/notes/{note_id}/comments"): (
        "创建文档评论或回复",
        "当前空间的所有活跃成员（含普通成员）均可在活跃文档上发表评论。body 去除首尾空白后不能为空；parent_id 省略或为 null 时创建独立评论，提供时必须引用同一文档中的评论。成功返回 HTTP 201。",
    ),
    ("patch", "/notes/{note_id}/comments/{comment_id}"): (
        "修改评论或解决状态",
        "评论正文仅作者可修改；作者、所有者、管理员或编辑者可通过 is_resolved 解决或重新打开该条评论。至少提供 body 或 is_resolved 中的一项，显式 null 不被接受，省略字段保持不变。正文权限与解决权限分别校验；同时提交无权修改的正文会导致整个请求失败。",
    ),
    ("get", "/notes/{note_id}/revisions"): (
        "分页查询文档历史",
        "当前空间的所有活跃成员均可查询活跃文档的历史元数据，按 content_version 倒序排列。列表只返回版本、作者与创建时间，结构化正文由历史详情接口读取；没有历史记录时返回空分页列表。",
    ),
    ("get", "/notes/{note_id}/revisions/{revision_id}"): (
        "读取文档历史正文",
        "读取指定活跃文档的历史元数据、结构化正文和派生纯文本。历史记录必须属于该文档与当前空间；跨文档或不存在的修订返回 REVISION_NOT_FOUND。读取不改变当前正文。",
    ),
    ("post", "/notes/{note_id}/revisions/{revision_id}/restore"): (
        "恢复文档历史版本",
        "所有者、管理员或编辑者以 expected_version 校验文档当前内容版本，将所选历史正文保存为新的内容版本并返回 NoteContentOut。expected_version 是当前版本而非目标历史版本；冲突返回 NOTE_VERSION_CONFLICT，客户端应重新读取后处理冲突。恢复保留被替换正文与原有历史，不覆盖历史记录。",
    ),
}

PARAMETER_DESCRIPTIONS = {
    "site_id": "当前工作空间中的站点 UUIDv7 标识。",
    "release_id": "该站点已有发布版本的 UUIDv7 标识。",
    "slug": "当前公开站点路径，使用小写英文、数字和连字符，长度为 1 至 80。",
    "note_id": "当前工作空间中活跃文档的 UUIDv7 标识。",
    "comment_id": "该文档评论的 UUIDv7 标识。",
    "revision_id": "该文档历史修订的 UUIDv7 标识。",
    "page": "页码，从 1 开始，默认 1。",
    "page_size": "每页数量，范围 1 至 100，默认 20。",
}

SITE_FIELDS = {
    "name": "站点显示名称，去除首尾空白后不能为空。",
    "slug": "全局唯一的站点配置路径；修改草稿路径不改变当前公开版本的路径。",
    "description": "站点简介，默认为空字符串。",
    "site_kind": "起始场景：knowledge 为个人知识站，handbook 为产品手册，help 为帮助中心。",
    "accent_color": "主题色，使用 # 开头的六位十六进制颜色，默认 #0f766e。",
    "navigation": "待发布的文档选集，最多 200 项，数组顺序决定导航顺序；文档和页面路径均不能重复。",
    "source": "文档来源：manual 维持手选，notebooks 自动解析笔记本和子树。旧客户端更新时省略本字段会保留已有配置。",
    "branding": "站点品牌、导航外链、页脚链接与主题设置，随发布版本固定。旧客户端省略时保留已有配置。",
}
COMMENT_FIELDS = {
    "body": "评论正文，长度为 1 至 10000；去除首尾空白后不能为空。",
    "parent_id": "父评论 UUIDv7 标识；独立评论为 null，回复必须引用同一文档的评论。",
}
REVISION_FIELDS = {
    "id": "历史修订 UUIDv7 标识，用于读取详情或恢复。",
    "content_version": "这条历史记录对应的文档内容版本号。",
    "author_name": "保存这条历史修订时记录的作者显示名称。",
    "created_at_ms": "历史修订创建时间，UTC Unix 毫秒时间戳。",
}
SCHEMA_FIELD_DESCRIPTIONS = {
    "SiteCreateRequest": SITE_FIELDS,
    "SiteUpdateRequest": {
        **SITE_FIELDS,
        "expected_version": "当前站点配置版本，必须与 config_version 一致；过期返回 409。",
    },
    "SiteOut": {
        **SITE_FIELDS,
        "id": "站点 UUIDv7 标识。",
        "config_version": "当前配置草稿版本，初始为 1，保存配置成功后递增。",
        "published_release_id": "当前公开发布版本 UUIDv7 标识；未发布或撤回时为 null。",
    },
    "SitePageOut": {
        "slug": "该页面的独立公开路径，不包含站点路径前缀。",
        "title": "发布快照中的导航标题，可独立于源文档标题。",
        "group": "发布快照中的导航分组；null 表示未分组。",
        "parent_slug": "同一栏目的父页面公开路径；根页面为 null。",
        "section": "顶部文档栏目名称；旧手选站点可为 null。",
        "description": "页面简介，默认使用空字符串。",
        "updated_at_ms": "来源文档最后更新时间，UTC Unix 毫秒时间戳；旧版本可为 null。",
    },
    "SiteSnapshotOut": {
        **{
            key: value
            for key, value in SITE_FIELDS.items()
            if key not in {"navigation", "source"}
        },
        "name": "快照中的站点名称。",
        "slug": "快照中的站点路径；发布后用于匿名入口，认证预览使用配置草稿路径。",
        "pages": "按导航顺序排列的完整公开页面；不包含内部文档、空间或作者标识。",
        "redirects": "已明确改名的页面旧路径到当前公开路径的映射，不包含内部文档标识。",
    },
    "SiteReleaseOut": {
        "id": "发布版本 UUIDv7 标识，用于切换站点公开版本。",
        "release_number": "站点内递增的发布版本号，首次发布为 1。",
    },
    "CommentCreateRequest": COMMENT_FIELDS,
    "CommentUpdateRequest": {
        "body": "仅作者可修改的评论正文；省略时保持不变，显式 null 或纯空白不被接受。",
        "is_resolved": "设为 true 解决该评论，false 重新打开；省略时保持不变，不接受 null。",
    },
    "CommentOut": {
        **COMMENT_FIELDS,
        "id": "评论 UUIDv7 标识。",
        "note_id": "评论所属文档 UUIDv7 标识。",
        "author_id": "评论作者的用户 UUIDv7 标识。",
        "author_name": "评论作者当前显示名称。",
        "is_resolved": "当前评论是否已解决；新评论默认为 false。",
    },
    "RevisionSummary": REVISION_FIELDS,
    "RevisionOut": REVISION_FIELDS,
    "RevisionRestoreRequest": {
        "expected_version": "文档当前内容版本，必须与当前 content_version 一致，不是待恢复的历史版本号。",
    },
}

SITE_ID = "019fe1e0-1234-7abc-8def-012345678910"
NOTE_ID = "019fe1e0-1234-7abc-8def-012345678911"
RELEASE_ID = "019fe1e0-1234-7abc-8def-012345678912"
COMMENT_ID = "019fe1e0-1234-7abc-8def-012345678913"
AUTHOR_ID = "019fe1e0-1234-7abc-8def-012345678914"
REVISION_ID = "019fe1e0-1234-7abc-8def-012345678915"
EXAMPLE_TIME_MS = 1789430400000
BLOCKS = {
    "schema_version": 1,
    "editor": "tiptap",
    "doc": {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "欢迎使用 Orbis。"}],
            }
        ],
    },
}
SITE_CONFIG = {
    "name": "Orbis 产品手册",
    "slug": "orbis-handbook",
    "description": "从第一篇文档开始协作与发布。",
    "site_kind": "handbook",
    "accent_color": "#0f766e",
    "source": {
        "kind": "manual",
        "notebooks": [],
        "excluded_note_ids": [],
        "page_overrides": [],
    },
    "branding": {
        "logo_url": None,
        "links": [],
        "footer_links": [],
        "cta": None,
        "theme": "system",
    },
    "navigation": [
        {
            "note_id": NOTE_ID,
            "slug": "getting-started",
            "title": "快速开始",
            "group": "入门",
        }
    ],
}
SITE = {
    **SITE_CONFIG,
    "id": SITE_ID,
    "config_version": 1,
    "published_release_id": None,
    "published_slug": None,
    "created_at_ms": EXAMPLE_TIME_MS,
    "updated_at_ms": EXAMPLE_TIME_MS,
}
SNAPSHOT = {
    **{
        key: value
        for key, value in SITE_CONFIG.items()
        if key not in {"navigation", "source"}
    },
    "redirects": {},
    "pages": [
        {
            "slug": "getting-started",
            "title": "快速开始",
            "group": "入门",
            "blocks": BLOCKS,
            "plain_text": "欢迎使用 Orbis。",
            "parent_slug": None,
            "section": None,
            "description": "",
            "updated_at_ms": EXAMPLE_TIME_MS,
        }
    ],
    "release_id": RELEASE_ID,
    "release_number": 1,
    "published_at_ms": EXAMPLE_TIME_MS,
}
COMMENT = {
    "id": COMMENT_ID,
    "note_id": NOTE_ID,
    "parent_id": None,
    "author_id": AUTHOR_ID,
    "author_name": "示例成员",
    "body": "这部分说明已经确认。",
    "is_resolved": False,
    "created_at_ms": EXAMPLE_TIME_MS,
    "updated_at_ms": EXAMPLE_TIME_MS,
}
REVISION = {
    "id": REVISION_ID,
    "content_version": 2,
    "author_name": "示例成员",
    "created_at_ms": EXAMPLE_TIME_MS,
}
RELEASE = {
    "id": RELEASE_ID,
    "release_number": 1,
    "published_at_ms": EXAMPLE_TIME_MS,
    "is_active": True,
}

REQUEST_EXAMPLES = {
    "SitePublishRequest": {
        "publish": {
            "summary": "携带认证预览返回的来源指纹发布；旧手选模式也接受空请求体",
            "value": {"expected_source_fingerprint": "a" * 64},
        },
    },
    "SiteCreateRequest": {
        "create": {"summary": "创建产品手册草稿", "value": SITE_CONFIG}
    },
    "SiteUpdateRequest": {
        "replace": {
            "summary": "以当前版本完整保存配置",
            "value": {**SITE_CONFIG, "expected_version": 1},
        }
    },
    "CommentCreateRequest": {
        "comment": {
            "summary": "创建独立评论",
            "value": {"body": COMMENT["body"], "parent_id": None},
        },
        "reply": {
            "summary": "回复同一文档中的评论",
            "value": {"body": "已补充相关说明。", "parent_id": COMMENT_ID},
        },
    },
    "CommentUpdateRequest": {
        "edit": {"summary": "作者修改正文", "value": {"body": "已更新这部分说明。"}},
        "resolve": {"summary": "解决评论", "value": {"is_resolved": True}},
        "reopen": {"summary": "重新打开评论", "value": {"is_resolved": False}},
    },
    "RevisionRestoreRequest": {
        "restore": {
            "summary": "当前正文为版本 3 时恢复历史正文",
            "value": {"expected_version": 3},
        }
    },
}


def _page(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "items": [item],
        "pagination": {
            "page": 1,
            "page_size": 20,
            "total": 1,
            "total_pages": 1,
            "has_next": False,
            "has_previous": False,
        },
    }


SUCCESS_DATA = {
    ("get", "/sites"): _page(SITE),
    ("post", "/sites"): SITE,
    ("get", "/sites/{site_id}"): SITE,
    ("put", "/sites/{site_id}"): {
        **SITE,
        "config_version": 2,
        "updated_at_ms": EXAMPLE_TIME_MS + 1000,
    },
    ("get", "/sites/{site_id}/preview"): {
        **SNAPSHOT,
        "release_id": None,
        "release_number": None,
        "published_at_ms": None,
        "source_fingerprint": "a" * 64,
    },
    ("post", "/sites/{site_id}/publish"): SNAPSHOT,
    ("get", "/sites/{site_id}/releases"): _page(RELEASE),
    ("post", "/sites/{site_id}/releases/{release_id}/activate"): {
        **SITE,
        "published_release_id": RELEASE_ID,
        "published_slug": SNAPSHOT["slug"],
    },
    ("post", "/sites/{site_id}/unpublish"): SITE,
    PUBLIC_OPERATION: SNAPSHOT,
    ("get", "/notes/{note_id}/comments"): _page(COMMENT),
    ("post", "/notes/{note_id}/comments"): COMMENT,
    ("patch", "/notes/{note_id}/comments/{comment_id}"): {
        **COMMENT,
        "body": "已更新这部分说明。",
        "updated_at_ms": EXAMPLE_TIME_MS + 1000,
    },
    ("get", "/notes/{note_id}/revisions"): _page(REVISION),
    ("get", "/notes/{note_id}/revisions/{revision_id}"): {
        **REVISION,
        "blocks": BLOCKS,
        "plain_text": "欢迎使用 Orbis。",
    },
    ("post", "/notes/{note_id}/revisions/{revision_id}/restore"): {
        "note_id": NOTE_ID,
        "blocks": BLOCKS,
        "plain_text": "欢迎使用 Orbis。",
        "content_version": 4,
        "created_at_ms": EXAMPLE_TIME_MS,
        "updated_at_ms": EXAMPLE_TIME_MS + 1000,
    },
}

ERROR_DOCS = {
    "SITE_SOURCE_INVALID": (422, "来源笔记本或根文档不可用，请检查空间归属与归档状态"),
    "SITE_SOURCE_CONFLICT": (409, "来源内容或配置已变化，请重新预览后发布"),
    "SITE_PREVIEW_REQUIRED": (422, "请先预览本次来源变化，再确认发布"),
    "SITE_TOO_MANY_PAGES": (422, "解析后的文档超过 200 篇，请缩小来源范围或排除子树"),
    "SITE_PAGE_PATH_CONFLICT": (422, "页面路径已被使用，请修改后重试"),
    "AUTH_REQUIRED": (401, "请先登录"),
    "INVALID_ACCESS_TOKEN": (401, "访问令牌无效或已过期"),
    "ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED": (403, "需要有效的工作空间成员身份"),
    "RESOURCE_MANAGE_FORBIDDEN": (403, "需要内容管理权限"),
    "SITE_PUBLISH_FORBIDDEN": (403, "仅所有者和管理员可以发布、切换版本或撤回站点"),
    "COLLABORATION_FORBIDDEN": (403, "当前账号无权执行此操作"),
    "SITE_NOT_FOUND": (404, "站点不存在"),
    "SITE_RELEASE_NOT_FOUND": (404, "站点发布版本不存在"),
    "NOTE_NOT_FOUND": (404, "文档不存在"),
    "COMMENT_NOT_FOUND": (404, "评论不存在"),
    "REVISION_NOT_FOUND": (404, "历史版本不存在"),
    "SITE_SLUG_CONFLICT": (409, "站点路径已被其他站点使用"),
    "SITE_VERSION_CONFLICT": (409, "站点配置或发布版本已更新，请刷新后重试"),
    "NOTE_VERSION_CONFLICT": (409, "文档内容版本冲突，请刷新后重试"),
    "SITE_DOCUMENT_INVALID": (422, "所选文档不存在、不属于当前空间或上级资源已归档"),
    "SITE_CONTENT_UNSAFE": (
        422,
        "文档包含不支持的内容或不适合公开的链接，请检查后重新发布",
    ),
    "SITE_EMPTY": (422, "请先选择至少一篇文档再发布"),
    "NOTE_CONTENT_INVALID": (422, "文档内容无效"),
    "VALIDATION_ERROR": (422, "请求字段校验失败"),
    "INTERNAL_ERROR": (500, "服务内部错误"),
}
OPERATION_ERRORS = {
    ("get", "/sites/{site_id}/sources"): (
        "SITE_NOT_FOUND",
        "SITE_SOURCE_INVALID",
        "SITE_DOCUMENT_INVALID",
        "SITE_TOO_MANY_PAGES",
        "SITE_PAGE_PATH_CONFLICT",
    ),
    ("get", "/sites"): (),
    ("post", "/sites"): (
        "RESOURCE_MANAGE_FORBIDDEN",
        "SITE_SLUG_CONFLICT",
        "SITE_DOCUMENT_INVALID",
    ),
    ("get", "/sites/{site_id}"): ("SITE_NOT_FOUND",),
    ("put", "/sites/{site_id}"): (
        "SITE_NOT_FOUND",
        "RESOURCE_MANAGE_FORBIDDEN",
        "SITE_SLUG_CONFLICT",
        "SITE_VERSION_CONFLICT",
        "SITE_DOCUMENT_INVALID",
    ),
    ("get", "/sites/{site_id}/preview"): (
        "SITE_NOT_FOUND",
        "SITE_DOCUMENT_INVALID",
        "SITE_CONTENT_UNSAFE",
    ),
    ("post", "/sites/{site_id}/publish"): (
        "SITE_NOT_FOUND",
        "SITE_PUBLISH_FORBIDDEN",
        "SITE_EMPTY",
        "SITE_DOCUMENT_INVALID",
        "SITE_CONTENT_UNSAFE",
        "SITE_SLUG_CONFLICT",
        "SITE_VERSION_CONFLICT",
    ),
    ("get", "/sites/{site_id}/releases"): ("SITE_NOT_FOUND",),
    ("post", "/sites/{site_id}/releases/{release_id}/activate"): (
        "SITE_NOT_FOUND",
        "SITE_RELEASE_NOT_FOUND",
        "SITE_PUBLISH_FORBIDDEN",
        "SITE_SLUG_CONFLICT",
    ),
    ("post", "/sites/{site_id}/unpublish"): (
        "SITE_NOT_FOUND",
        "SITE_PUBLISH_FORBIDDEN",
    ),
    PUBLIC_OPERATION: ("SITE_NOT_FOUND",),
    ("get", "/notes/{note_id}/comments"): ("NOTE_NOT_FOUND",),
    ("post", "/notes/{note_id}/comments"): ("NOTE_NOT_FOUND", "COMMENT_NOT_FOUND"),
    ("patch", "/notes/{note_id}/comments/{comment_id}"): (
        "NOTE_NOT_FOUND",
        "COMMENT_NOT_FOUND",
        "COLLABORATION_FORBIDDEN",
    ),
    ("get", "/notes/{note_id}/revisions"): ("NOTE_NOT_FOUND",),
    ("get", "/notes/{note_id}/revisions/{revision_id}"): (
        "NOTE_NOT_FOUND",
        "REVISION_NOT_FOUND",
    ),
    ("post", "/notes/{note_id}/revisions/{revision_id}/restore"): (
        "NOTE_NOT_FOUND",
        "REVISION_NOT_FOUND",
        "COLLABORATION_FORBIDDEN",
        "NOTE_VERSION_CONFLICT",
        "NOTE_CONTENT_INVALID",
    ),
}

SOURCE_PAGE = {
    "note_id": NOTE_ID,
    **{
        key: value
        for key, value in SNAPSHOT["pages"][0].items()
        if key not in {"blocks", "plain_text"}
    },
}
SUCCESS_DATA[("get", "/sites/{site_id}/sources")] = {
    "pages": [SOURCE_PAGE],
    "excluded_count": 0,
    "source_fingerprint": "a" * 64,
    "changes": {"added": [SOURCE_PAGE], "modified": [], "removed": []},
}
SCHEMA_FIELD_DESCRIPTIONS["SitePreviewOut"] = SCHEMA_FIELD_DESCRIPTIONS[
    "SiteSnapshotOut"
]
for key in [
    ("post", "/sites"),
    ("put", "/sites/{site_id}"),
    ("get", "/sites/{site_id}/preview"),
    ("post", "/sites/{site_id}/publish"),
]:
    OPERATION_ERRORS[key] += (
        "SITE_SOURCE_INVALID",
        "SITE_TOO_MANY_PAGES",
        "SITE_PAGE_PATH_CONFLICT",
    )
for key in [("get", "/sites/{site_id}/preview"), ("post", "/sites/{site_id}/publish")]:
    OPERATION_ERRORS[key] += ("SITE_SOURCE_CONFLICT",)
OPERATION_ERRORS[("post", "/sites/{site_id}/publish")] += ("SITE_PREVIEW_REQUIRED",)


def validation_error_data(method: str, path: str) -> dict[str, Any]:
    """Show one real validation-error shape for each operation's input boundary."""
    if method == "get" and path in PAGINATED_PATHS:
        field, code, message = "query.page", "GREATER_THAN_EQUAL", "字段值低于允许范围"
    elif (method, path) == ("post", "/sites"):
        field, code, message = "body.name", "STRING_TOO_SHORT", "字符串长度不足"
    elif method == "put" or path.endswith("/restore"):
        field, code, message = (
            "body.expected_version",
            "GREATER_THAN_EQUAL",
            "字段值低于允许范围",
        )
    elif method in {"post", "patch"} and "/comments" in path:
        field, code, message = "body.body", "VALUE_ERROR", "字段值不正确"
    elif (method, path) == PUBLIC_OPERATION:
        field, code, message = (
            "path.slug",
            "STRING_PATTERN_MISMATCH",
            "字段值不符合要求",
        )
    else:
        parameter = path.split("{", 1)[1].split("}", 1)[0]
        field, code, message = f"path.{parameter}", "UUID_PARSING", "字段值不符合要求"
    return {"errors": [{"field": field, "code": code, "message": message}]}
