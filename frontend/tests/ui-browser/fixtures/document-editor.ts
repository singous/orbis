import type { Page } from "@playwright/test";
import { pagination, user, workspace } from "./session";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const documentId = id(20);
const notebook = { id: id(21), workspace_id: workspace.id, group_id: id(22), title: "产品知识库", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const document = { id: documentId, workspace_id: workspace.id, collection_id: notebook.id, parent_id: null, position: 0, title: "界面平台化设计", content_version: 4, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const blocks = [
  { type: "heading", props: { level: 2 }, text: "用更清晰的方式整理知识" },
  { type: "paragraph", props: {}, text: "这是一份固定的文档内容，用于验证标题、正文与上下文大纲的视觉呈现。" },
  { type: "paragraph", props: {}, text: "把日常记录、项目资料和团队经验放在一起，让每个想法都能找到自己的位置。" },
  { type: "heading", props: { level: 2 }, text: "协作与知识组织" },
  { type: "paragraph", props: {}, text: "标题和正文保持原有编辑结构，目录会跟随章节显示。" },
].map((block, position) => ({ id: id(30 + position), parent_id: null, position, block_type: block.type, payload_loaded: true, payload_bytes: 200, payload: { type: block.type, props: block.props, content: [{ text: block.text, marks: [], href: null }] }, child_count: 0, block_revision: document.content_version }));

export async function documentEditorHTTP(page: Page) {
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(`${request.method()} ${path}`);
    let data: unknown = { items: [], pagination };
    if (path.endsWith(`/documents/${documentId}/children`)) data = { version: document.content_version, items: blocks, pagination: { next_cursor: null, has_more: false } };
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
