/**
 * TEMPORARY visual-check harness. Not part of the app, not imported by it.
 *
 * Renders the real App against a stubbed API so the workspace shell can be
 * screenshotted without a database. Delete this file and visual.html once the
 * visual pass is done.
 */
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import { authStore } from "./shared/auth/auth-store";
import "./styles/index.css";
import "./styles/glass-theme.css";

const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const OWNER_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const now = Date.UTC(2026, 7, 17, 9, 30);

function id(suffix: string): string {
  return `018ff7c4-a5b6-7000-8000-0000000${suffix}`;
}

function identity(entityId: string, updatedOffsetMs: number) {
  return {
    id: entityId,
    tenant_id: null,
    workspace_id: WORKSPACE_ID,
    owner_id: OWNER_ID,
    status: "active",
    created_at_ms: now - 90 * 86_400_000,
    updated_at_ms: now - updatedOffsetMs,
  };
}

function pagination(total: number) {
  return { page: 1, page_size: 20, total, total_pages: 1, has_next: false, has_previous: false };
}

const groups = [
  { ...identity(id("10001"), 86_400_000), name: "产品", is_default: true, sort_order: 0 },
  { ...identity(id("10002"), 3 * 86_400_000), name: "工程", is_default: false, sort_order: 1 },
  { ...identity(id("10003"), 9 * 86_400_000), name: "运营", is_default: false, sort_order: 2 },
];

const notebooks = [
  { ...identity(id("20001"), 3_600_000), group_id: groups[0].id, title: "产品手册", sort_order: 0 },
  { ...identity(id("20002"), 2 * 86_400_000), group_id: groups[0].id, title: "需求池", sort_order: 1 },
  { ...identity(id("20003"), 5 * 86_400_000), group_id: groups[1].id, title: "架构决策记录", sort_order: 2 },
  { ...identity(id("20004"), 8 * 86_400_000), group_id: groups[1].id, title: "接口契约", sort_order: 3 },
  { ...identity(id("20005"), 20 * 86_400_000), group_id: groups[2].id, title: "增长实验", sort_order: 4 },
];

const noteTitles: [string, string, number][] = [
  ["社区版 v0 发布范围", "本次发布覆盖认证、工作空间外壳、在线文档与成员管理四条主线，知识库与记忆库仍为占位。", 1_800_000],
  ["文档树排序与移动规则", "同级排序使用 sort_order，跨级移动需要先校验父节点状态，避免出现悬挂节点。", 7_200_000],
  ["编辑器自动保存节流方案", "长文按内容长度动态放宽保存间隔，脏窗口设上限，避免回声覆盖正在输入的内容。", 2 * 86_400_000],
  ["归档与恢复的父子约束", "恢复子节点前必须先恢复父节点，接口在冲突时返回明确的错误码与提示文案。", 4 * 86_400_000],
  ["成员邀请邮件失败重试", "邮件发送失败不阻塞邀请创建，失败原因摘要落库，后台任务按退避策略重试。", 6 * 86_400_000],
  ["工作区切换的会话语义", "切换工作区只更新当前上下文，不重签令牌，避免打断正在进行的编辑会话。", 11 * 86_400_000],
];

const notes = noteTitles.map(([title, plain_text, offset], index) => ({
  ...identity(id(`3000${index}`), offset),
  notebook_id: notebooks[index % notebooks.length].id,
  parent_id: null,
  sort_order: index,
  title,
  note_type: "doc",
  plain_text,
}));

const user = {
  id: OWNER_ID,
  tenant_id: null,
  email: "ada@orbis.dev",
  display_name: "Ada",
  current_workspace_id: WORKSPACE_ID,
  status: "active",
  created_at_ms: now - 200 * 86_400_000,
  updated_at_ms: now,
};

const workspace = {
  id: WORKSPACE_ID,
  name: "Orbis 团队",
  workspace_type: "team",
  role: "owner" as const,
  is_current: true,
  created_at_ms: now - 200 * 86_400_000,
  updated_at_ms: now,
};

function envelope(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: "OK", message: "success", request_id: "visual-harness", data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function resolve(pathname: string): unknown {
  if (pathname.startsWith("/document-groups")) return { items: groups, pagination: pagination(groups.length) };
  if (pathname.startsWith("/notebooks")) return { items: notebooks, pagination: pagination(notebooks.length) };
  if (pathname.startsWith("/notes")) return { items: notes, pagination: pagination(notes.length) };
  if (pathname.startsWith("/workspaces")) return { items: [workspace], pagination: pagination(1) };
  if (pathname.startsWith("/members")) return { items: [], pagination: pagination(0) };
  return { items: [], pagination: pagination(0) };
}

window.fetch = async (input: RequestInfo | URL) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const { pathname } = new URL(raw, window.location.origin);
  return envelope(resolve(pathname.replace(/^\/api/, "")));
};

// Seed through the store, not localStorage: auth-store reads storage during
// its own module evaluation, which ES module hoisting runs before this file's
// body, so a localStorage write here would arrive too late.
authStore.getState().setSession({
  accessToken: "visual",
  refreshToken: "visual",
  user,
  workspace,
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
