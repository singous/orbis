import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteContent } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { DocumentCollaborationPanel } from "./DocumentCollaborationPanel";
import { COMMENT_ID, NEXT_ID, NOTE_ID, OTHER_ID, REVISION_ID, USER_ID, blocks, comment, content, http, page, response, revision, session } from "./collaboration.test-utils";

const clients: QueryClient[] = [];
function showPanel({ canManage = true, onRestore = async (restore: (version: number) => Promise<NoteContent>) => { await restore(4); } } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><DocumentCollaborationPanel noteId={NOTE_ID} currentUserId={USER_ID} canManage={canManage} onClose={() => {}} onRestore={onRestore} /></QueryClientProvider>);
  return client;
}

beforeEach(() => { act(() => authStore.setState(session)); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });

describe("document collaboration", () => {
  it("submits a comment and reply, then edits and resolves through the real query cache", async () => {
    let comments = [comment()];
    const requests = http((url, init) => {
      if (init.method === "POST") {
        const input = JSON.parse(String(init.body));
        const created = { ...comment(input.body), id: comments.length === 1 ? NEXT_ID : OTHER_ID, parent_id: input.parent_id ?? null };
        comments = [...comments, created];
        return response(created, 201);
      }
      if (init.method === "PATCH") {
        const input = JSON.parse(String(init.body));
        comments = comments.map((item) => item.id === COMMENT_ID ? { ...item, ...input } : item);
        return response(comments[0]);
      }
      return response(page(comments));
    });
    const user = userEvent.setup();
    const client = showPanel({ canManage: false });
    await screen.findByText("第一条讨论");
    await user.click(screen.getByRole("button", { name: "编辑评论" }));
    await user.clear(screen.getByLabelText("编辑评论正文"));
    await user.type(screen.getByLabelText("编辑评论正文"), "修订后的讨论");
    await user.click(screen.getByRole("button", { name: "保存评论" }));
    await screen.findByText("修订后的讨论");
    await user.click(screen.getByRole("button", { name: "回复评论" }));
    await user.type(screen.getByLabelText("回复内容"), "补充说明");
    await user.click(screen.getByRole("button", { name: "发送回复" }));
    await screen.findByText("补充说明");
    expect(screen.getByText(/回复 作者/)).toBeInTheDocument();
    const original = screen.getByText("修订后的讨论").closest("article")!;
    await user.click(within(original).getByRole("button", { name: "解决讨论" }));
    await waitFor(() => expect(within(original).getByRole("button", { name: "重新打开讨论" })).toBeInTheDocument());
    await user.click(within(original).getByRole("button", { name: "重新打开讨论" }));
    await waitFor(() => expect(within(original).getByRole("button", { name: "解决讨论" })).toBeInTheDocument());
    await user.type(screen.getByLabelText("新评论"), "独立评论");
    await user.click(screen.getByRole("button", { name: "发表评论" }));
    await screen.findByText("独立评论");
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({ body: "补充说明", parent_id: COMMENT_ID });
    expect(JSON.stringify(client.getQueriesData({ queryKey: ["collaboration", NOTE_ID, "comments"] }))).toContain("独立评论");
  });

  it("loads additional comment pages without dropping the parent discussion", async () => {
    const requests = http((url) => response(url.searchParams.get("page") === "2" ? page([{ ...comment("第二页回复"), id: NEXT_ID, parent_id: COMMENT_ID }], 2) : page([comment()], 1, true)));
    const user = userEvent.setup();
    showPanel();
    await user.click(await screen.findByRole("button", { name: "加载更多评论" }));
    await screen.findByText("第二页回复");
    expect(screen.getByText("第一条讨论")).toBeInTheDocument();
    expect(screen.getByText(/回复 作者/)).toBeInTheDocument();
    expect(requests.some((request) => request.path.endsWith("page=2&page_size=20"))).toBe(true);
  });

  it("keeps the submitted draft visible after a network error", async () => {
    http((_url, init) => init.method === "POST" ? response(null, 500, "评论保存失败") : response(page([])));
    const user = userEvent.setup();
    showPanel();
    await user.type(screen.getByLabelText("新评论"), "不能丢失的评论");
    await user.click(screen.getByRole("button", { name: "发表评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("评论保存失败");
    expect(screen.getByLabelText("新评论")).toHaveValue("不能丢失的评论");
    expect(screen.getByRole("button", { name: "发表评论" })).toBeEnabled();
  });

  it("allows ordinary members to comment and read history without editing others or restoring", async () => {
    http((url) => response(url.pathname.endsWith("revisions") ? page([revision]) : page([{ ...comment(), author_id: OTHER_ID }])));
    const user = userEvent.setup();
    showPanel({ canManage: false });
    await screen.findByText("第一条讨论");
    expect(screen.queryByRole("button", { name: "编辑评论" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解决讨论" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回复评论" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "历史版本" }));
    await screen.findByRole("button", { name: /查看版本 2/ });
    expect(screen.queryByRole("button", { name: "恢复此版本" })).not.toBeInTheDocument();
    expect(screen.getByText(/只读成员/)).toBeInTheDocument();
  });

  it("previews paginated revision content and restores using the prepared current version", async () => {
    const requests = http((url, init) => {
      if (init.method === "POST") return response(content(9, "历史正文"));
      if (url.pathname.endsWith(REVISION_ID)) return response({ ...revision, blocks: blocks("历史正文"), plain_text: "历史正文" });
      if (url.pathname.endsWith("revisions")) return response(url.searchParams.get("page") === "2" ? page([revision], 2) : page([{ ...revision, id: NEXT_ID, content_version: 8 }], 1, true));
      return response(page([]));
    });
    const user = userEvent.setup();
    const client = showPanel({ onRestore: async (restore) => { await restore(8); } });
    await user.click(screen.getByRole("button", { name: "历史版本" }));
    await user.click(await screen.findByRole("button", { name: "加载更多版本" }));
    await user.click(await screen.findByRole("button", { name: /查看版本 2/ }));
    await screen.findByText("历史正文");
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    await screen.findByRole("status", { name: "恢复结果" });
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({ expected_version: 8 });
    expect(client.getQueryData(["note-content", NOTE_ID])).toEqual(content(9, "历史正文"));
  });

  it("shows a restore conflict and keeps the selected preview", async () => {
    http((url, init) => {
      if (init.method === "POST") return response(null, 409, "文档版本已变更");
      if (url.pathname.endsWith(REVISION_ID)) return response({ ...revision, blocks: blocks("历史正文"), plain_text: "历史正文" });
      return response(page(url.pathname.endsWith("revisions") ? [revision] : []));
    });
    const user = userEvent.setup();
    const client = showPanel();
    client.setQueryData(["note-content", NOTE_ID], content());
    await user.click(screen.getByRole("button", { name: "历史版本" }));
    await user.click(await screen.findByRole("button", { name: /查看版本 2/ }));
    await screen.findByText("历史正文");
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/版本|冲突/);
    expect(screen.getByText("历史正文")).toBeInTheDocument();
    expect(client.getQueryData(["note-content", NOTE_ID])).toEqual(content());
  });
  it("refreshes an expired access token before displaying comments", async () => {
    const requests = http((url, init) => {
      if (url.pathname.endsWith("/auth/refresh")) return response({ access_token: "renewed-access" });
      return new Headers(init.headers).get("Authorization") === "Bearer renewed-access" ? response(page([comment()])) : response(null, 401, "登录已过期");
    });
    showPanel();
    await screen.findByText("第一条讨论");
    expect(authStore.getState().accessToken).toBe("renewed-access");
    expect(requests.filter((request) => request.method === "GET").map((request) => request.headers.get("Authorization"))).toEqual(["Bearer access", "Bearer renewed-access"]);
  });

  it("can retry a failed comment list request", async () => {
    let unavailable = true;
    http(() => unavailable ? response(null, 503, "暂时无法加载评论") : response(page([comment()])));
    const user = userEvent.setup();
    showPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法加载评论");
    unavailable = false;
    await user.click(screen.getByRole("button", { name: "重试加载评论" }));
    await screen.findByText("第一条讨论");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a newly posted comment beyond the loaded pages without duplicating it later", async () => {
    const newest = { ...comment("最新发表"), id: NEXT_ID };
    http((url, init) => {
      if (init.method === "POST") return response(newest, 201);
      return response(url.searchParams.get("page") === "2" ? page([newest], 2) : page([comment()], 1, true));
    });
    const user = userEvent.setup();
    showPanel();
    await screen.findByText("第一条讨论");
    await user.type(screen.getByLabelText("新评论"), "最新发表");
    await user.click(screen.getByRole("button", { name: "发表评论" }));
    await screen.findByText("最新发表");
    await user.click(screen.getByRole("button", { name: "加载更多评论" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "加载更多评论" })).not.toBeInTheDocument());
    expect(screen.getAllByText("最新发表")).toHaveLength(1);
  });

});
