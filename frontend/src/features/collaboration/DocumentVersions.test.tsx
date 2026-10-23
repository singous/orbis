import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { DocumentCollaborationPanel } from "./DocumentCollaborationPanel";
import { NOTE_ID, USER_ID, REVISION_ID, session, response, http } from "./collaboration.test-utils";
import { nativeSnapshot } from "../documents/editor/editor.test-utils";
import type { DocumentVersion } from "./version-api";

const version: DocumentVersion = { id: REVISION_ID, document_id: NOTE_ID, source_revision: 37, kind: "named", name: "评审稿", description: "已确认范围", title: "产品计划", title_recorded: true, content_hash: "a".repeat(64), content_schema: "orbis.document-version.v1", author_id: USER_ID, author_name: "作者", metadata_version: 1, captured_at_ms: 1, created_at_ms: 1, updated_at_ms: 1 };
const cursorPage = <T,>(items: T[], next: string | null = null) => ({ items, pagination: { next_cursor: next, has_more: next !== null }, automatic_history_enabled:true });
beforeEach(() => { authStore.getState().setSession(session); });
afterEach(() => { cleanup(); authStore.getState().clearSession(); vi.unstubAllGlobals(); });
function show(options: { onPrepareVersion?: () => Promise<number>; canManage?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DocumentCollaborationPanel noteId={NOTE_ID} currentUserId={USER_ID} canManage={options.canManage ?? true} onClose={vi.fn()} onPrepareVersion={options.onPrepareVersion} onRestore={async restore => { await restore(42); }} /></QueryClientProvider>);
  return client;
}
async function history(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole("tab", { name: "历史版本" })); }

it("shows names and fixed content without exposing the commit counter", async () => {
  http(url => {
    if (url.pathname.endsWith("/versions")) return response(cursorPage([version]));
    if (url.pathname.endsWith("/content")) return response({ version, dependencies: [], content: nativeSnapshot(37, "Fixed review body") });
    return response({ items: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0, has_next: false, has_previous: false } });
  });
  const user = userEvent.setup(); show({ canManage: false }); await history(user);
  await user.click(await screen.findByRole("button", { name: "查看版本 评审稿" }));
  await screen.findByText("Fixed review body");
  expect(screen.queryByText("版本 37")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "恢复此版本" })).not.toBeInTheDocument();
  expect(screen.getByText(/只读成员/)).toBeInTheDocument();
});

it("flushes local edits before naming a fixed revision and retains the operation ID for uncertain retries", async () => {
  let writes = 0;
  const prepared = vi.fn().mockResolvedValue(37);
  const requests = http((url, init) => {
    if (init.method === "POST") { writes++; return writes === 1 ? response(null, 503, "暂时不可用") : response(version, 201); }
    if (url.pathname.endsWith("/content")) return response({ version, dependencies: [], content: nativeSnapshot(37, "Saved body") });
    if (url.pathname.endsWith("/versions")) return response(cursorPage(writes >= 2 ? [version] : []));
    return response({ items: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0, has_next: false, has_previous: false } });
  });
  const user = userEvent.setup(); show({ onPrepareVersion: prepared }); await history(user);
  await user.click(screen.getByRole("button", { name: "新建命名版本" }));
  await user.type(screen.getByLabelText("新版本名称"), "评审稿");
  await user.click(screen.getByRole("button", { name: "保存命名版本" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("新版本名称")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "重试保存版本" }));
  await screen.findByText("Saved body");
  expect(prepared).toHaveBeenCalledTimes(1);
  const posts = requests.filter(request => request.method === "POST");
  expect(posts).toHaveLength(2); expect(posts[0].body).toEqual(posts[1].body);
  expect(posts[0].body).toMatchObject({ source_revision: 37, name: "评审稿" });
});

it("restores the selected version through its UUID and reports persistence failure without discarding the preview", async () => {
  const requests = http((url, init) => {
    if (init.method === "POST") return response(null, 409, "当前内容已变化");
    if (url.pathname.endsWith("/content")) return response({ version, dependencies: [], content: nativeSnapshot(37, "Review preview") });
    if (url.pathname.endsWith("/versions")) return response(cursorPage([version]));
    return response({ items: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0, has_next: false, has_previous: false } });
  });
  const user = userEvent.setup(); show(); await history(user);
  await user.click(await screen.findByRole("button", { name: "查看版本 评审稿" }));
  await screen.findByText("Review preview"); await user.click(screen.getByRole("button", { name: "恢复此版本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("当前内容已变化");
  expect(screen.getByText("Review preview")).toBeInTheDocument();
  const request = requests.find(request => request.method === "POST");
  expect(request?.path).toContain(`/versions/${REVISION_ID}/restore`);
  expect(request?.body).toMatchObject({ expected_revision: 42, operation_id: expect.any(String) });
});
