import type { Page } from "@playwright/test";
import type { NativePayload } from "../../../src/features/content/codecs/api-content";
import { pagination, user, workspace } from "./session";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const documentId = id(20);
const notebook = { id: id(21), workspace_id: workspace.id, group_id: id(22), title: "产品知识库", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const document = { id: documentId, workspace_id: workspace.id, collection_id: notebook.id, parent_id: null, position: 0, title: "界面平台化设计", content_version: 4, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
function run(text: string, href: string | null = null) {
  return { text, marks: [], href };
}

function blockRows(payloads: NativePayload[]) {
  return payloads.map((payload, position) => ({
    id: id(30 + position), parent_id: null, position, block_type: payload.type,
    payload_loaded: true, payload_bytes: 200, payload, child_count: 0, block_revision: document.content_version,
  }));
}

const blocks = blockRows([
  { type: "heading", props: { level: 2 }, text: "用更清晰的方式整理知识" },
  { type: "paragraph", props: {}, text: "这是一份固定的文档内容，用于验证标题、正文与上下文大纲的视觉呈现。" },
  { type: "paragraph", props: {}, text: "把日常记录、项目资料和团队经验放在一起，让每个想法都能找到自己的位置。" },
  { type: "heading", props: { level: 2 }, text: "协作与知识组织" },
  { type: "paragraph", props: {}, text: "标题和正文保持原有编辑结构，目录会跟随章节显示。" },
].map(block => ({ type: block.type, props: block.props, content: [run(block.text)] })));

const cell = (text: string) => ({ content: [run(text)], row_span: 1, column_span: 1, alignment: "left", text_color: null, background_color: null });
export const designCode = '{\n  "state": "ready",\n  "count": 3\n}';
export const designedBlocks = blockRows([
  { type: "paragraph", props: {}, content: [run("让第一次使用 Orbis 的人，从创建一篇文档开始。")] },
  { type: "heading", props: { level: 2 }, content: [run("01 目标与设计原则")] },
  { type: "quote", props: {}, content: [run("先表达，再组织。工具应该在需要的时候出现。")] },
  { type: "heading", props: { level: 3 }, content: [run("交互原则")] },
  { type: "bullet_list_item", props: {}, content: [run("保持输入连续，不打断思路。")] },
  { type: "bullet_list_item", props: {}, content: [run("操作就近出现，降低寻找成本。")] },
  { type: "numbered_list_item", props: { start: 1 }, content: [run("创建文档，写下第一个想法。")] },
  { type: "numbered_list_item", props: { start: 2 }, content: [run("使用块组织内容与资料。")] },
  { type: "heading", props: { level: 2 }, content: [run("02 本轮交付")] },
  { type: "check_list_item", props: { checked: true }, content: [run("完成编辑器基础结构")] },
  { type: "check_list_item", props: { checked: false }, content: [run("验证自动保存体验")] },
  { type: "table", props: {}, content: [], table: {
    rows: [["模块", "交付内容", "状态"], ["基础编辑", "段落、标题、列表与引用", "已完成"], ["组织内容", "表格、代码与附件", "进行中"]].map(row => row.map(cell)),
    column_widths: [160, null, 108], header_rows: 1, header_columns: 0,
  } },
  { type: "heading", props: { level: 2 }, content: [run("03 实现参考与素材")] },
  { type: "code_block", props: { language: "json" }, content: [run(designCode)] },
  { type: "image", props: { source: null }, content: [] },
  { type: "paragraph", props: {}, content: [run("Orbis · 编辑器交互规范", "https://example.test/design")] },
  { type: "divider", props: {}, content: [] },
]);

export async function documentEditorHTTP(page: Page, content = blocks) {
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(`${request.method()} ${path}`);
    let data: unknown = { items: [], pagination };
    if (path.endsWith(`/documents/${documentId}/children`)) data = { version: document.content_version, items: content, pagination: { next_cursor: null, has_more: false } };
    else if (path.endsWith(`/documents/${documentId}`)) data = document;
    else if (path.endsWith(`/collections/${notebook.id}`)) data = notebook;
    else if (path.endsWith("/collections")) data = { items: [notebook], pagination: { ...pagination, total: 1 } };
    else if (path.endsWith("/documents")) data = { items: [document], pagination: { ...pagination, total: 1 }, directory_version: 1 };
    else if (path.endsWith("/collection-groups")) data = { items: [{ id: notebook.group_id, workspace_id: workspace.id, name: "项目资料", is_default: true, sort_order: 0, version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 }], pagination: { ...pagination, total: 1 } };
    else if (path.endsWith("/me")) data = user;
    else if (path.endsWith("/workspaces")) data = { items: [workspace], pagination: { ...pagination, total: 1 } };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "document-editor-surface", data } });
  });
  return mutations;
}
