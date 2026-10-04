import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { authStore } from "../../src/shared/auth/auth-store";
import { ShareButton } from "../../src/features/sharing/ShareButton";
import { PublicSharePage } from "../../src/features/sharing/PublicSharePage";
import {
  hydratedSharedBlocks,
  sharedNoteLink,
} from "../../src/features/sharing/share-content-model";
import type {
  PublicShare,
  SharedContentPage,
} from "../../src/features/sharing/api";

const rootId = "0190a111-1111-7111-8111-111111111111";
const childId = "0190a111-1111-7111-8111-111111111112";
const bookId = "0190a111-1111-7111-8111-111111111113";
const shareId = "0190a111-1111-7111-8111-111111111114";
const token = "test-token";
const manifest: PublicShare = {
  title: "团队实时资料",
  root_note_id: rootId,
  items: [
    {
      id: rootId,
      parent_id: null,
      title: "目录根",
      sort_order: 0,
      updated_at_ms: 1,
    },
    {
      id: childId,
      parent_id: rootId,
      title: "嵌套文档",
      sort_order: 0,
      updated_at_ms: 1,
    },
  ],
};
function page(text: string, version = 1): SharedContentPage {
  return {
    note_id: rootId,
    title: "目录根",
    content_version: version,
    updated_at_ms: version,
    offset: 0,
    next_offset: 1,
    total_blocks: 1,
    has_more: false,
    parent_id: null,
    blocks: {
      schema_version: 2,
      blocks: [
        { id: "p1", type: "paragraph", content: text, props: {}, children: [] },
      ],
    },
    descriptors: [
      {
        id: "p1",
        parent_id: null,
        child_count: 0,
        has_children: false,
        children_loaded: true,
        payload_loaded: true,
        payload_bytes: 32,
      },
    ],
    oversized_block: false,
  };
}
function response(data: unknown, status = 200, code = "OK") {
  return new Response(
    JSON.stringify({
      code,
      message: status === 404 ? "分享已撤销" : "请求成功",
      request_id: "test",
      data,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
function publicReader(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route
            path="/share/:shareToken/:noteId?"
            element={<PublicSharePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  authStore.getState().clearSession();
});

it("reads anonymous current content, nested directory and live edits without login headers", async () => {
  const client = queryClient();
  let current = page("刚写入的在线正文");
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.headers).not.toHaveProperty("Authorization");
    return response(url.includes("/content?") ? current : manifest);
  });
  vi.stubGlobal("fetch", fetchMock);
  publicReader(client);
  await screen.findByText("刚写入的在线正文");
  expect(screen.getByRole("link", { name: "嵌套文档" })).toHaveAttribute(
    "href",
    `/share/${token}/${childId}`,
  );
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
  current = page("实时更新后的正文", 2);
  await userEvent.click(screen.getByRole("button", { name: "刷新目录与正文" }));
  await screen.findByText("实时更新后的正文");
  expect(screen.queryByText("刚写入的在线正文")).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([url]) => url.includes("/content?")).length,
  ).toBeGreaterThan(1);
  client.clear();
});

it("removes previously visible current text when the link is revoked", async () => {
  const client = queryClient();
  let revoked = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      revoked
        ? response(null, 404, "SHARE_NOT_FOUND")
        : response(
            url.includes("/content?") ? page("撤销前可读正文") : manifest,
          ),
    ),
  );
  publicReader(client);
  await screen.findByText("撤销前可读正文");
  revoked = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["public-share", token] });
  });
  await screen.findByRole("heading", { name: "分享已失效或文档不可访问" });
  expect(screen.queryByText("撤销前可读正文")).not.toBeInTheDocument();
  client.clear();
});

it("hides moved-out documents and their old content after directory refresh", async () => {
  const client = queryClient();
  let currentManifest = manifest;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      response(
        url.includes("/content?") ? page("移出前可读正文") : currentManifest,
      ),
    ),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/share/${token}/${childId}`]}>
        <Routes>
          <Route
            path="/share/:shareToken/:noteId?"
            element={<PublicSharePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("移出前可读正文");
  currentManifest = {
    ...manifest,
    items: manifest.items.filter((item) => item.id !== childId),
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["public-share", token] });
  });
  await screen.findByRole("heading", { name: "分享已失效或文档不可访问" });
  expect(screen.queryByText("移出前可读正文")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "嵌套文档" }),
  ).not.toBeInTheDocument();
  client.clear();
});

it("loads container descendants only after explicit request and restores their structure", async () => {
  const client = queryClient();
  const first = page("");
  first.blocks.blocks = [
    {
      id: "quote",
      type: "quote",
      props: {},
      content: "容器正文",
      children: [],
    },
  ];
  first.descriptors = [
    {
      id: "quote",
      parent_id: null,
      child_count: 1,
      has_children: true,
      children_loaded: false,
      payload_loaded: true,
      payload_bytes: 32,
    },
  ];
  const child = {
    ...page("按需加载的嵌套正文"),
    parent_id: "quote",
    descriptors: [{ ...page("").descriptors[0], parent_id: "quote" }],
  };
  const fetchMock = vi.fn(async (url: string) =>
    response(
      url.includes("parent_id=quote")
        ? child
        : url.includes("/content?")
          ? first
          : manifest,
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  publicReader(client);
  await screen.findByText("容器正文");
  expect(
    fetchMock.mock.calls.some(([url]) => url.includes("parent_id=quote")),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "加载 引用子内容（0/1）" }),
  );
  await screen.findByText("按需加载的嵌套正文");
  expect(
    screen.getByText("按需加载的嵌套正文").closest("blockquote"),
  ).toBeInTheDocument();
  client.clear();
});

it("discloses live future scope before creating a link and supports revocation", async () => {
  const client = queryClient();
  const user = userEvent.setup();
  authStore.setState({ accessToken: "owner-token", refreshToken: null });
  let shares: unknown[] = [];
  const created = {
    id: shareId,
    notebook_id: bookId,
    root_note_id: rootId,
    created_at_ms: 1,
    revoked_at_ms: null,
    token,
    path: `/share/${token}`,
  };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer owner-token",
    });
    if (options?.method === "POST" && url === "/api/shares") {
      expect(JSON.parse(String(options.body))).toMatchObject({
        acknowledge_public_scope: true,
        root_note_id: rootId,
      });
      shares = [created];
      return response(created, 201);
    }
    if (url.endsWith("/revoke")) {
      shares = [{ ...created, revoked_at_ms: 2 }];
      return response(shares[0]);
    }
    return response({ items: shares });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client}>
      <ShareButton notebookId={bookId} noteId={rootId} title="目录根" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "分享" }));
  expect(
    await screen.findByText(/此范围内未来新增或移入的文档也会公开/),
  ).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "创建公开链接" }));
  await waitFor(() =>
    expect(screen.getByLabelText("公开链接")).toHaveValue(
      new URL(`/share/${token}`, window.location.origin).href,
    ),
  );
  await user.click(screen.getByRole("button", { name: "关闭", exact: true }));
  await user.click(screen.getByRole("button", { name: "分享", exact: true }));
  const clipboard = vi.spyOn(navigator.clipboard, "writeText");
  await user.click(
    await screen.findByRole("button", { name: "复制已有分享链接" }),
  );
  expect(clipboard).toHaveBeenCalledWith(
    new URL(`/share/${token}`, window.location.origin).href,
  );
  await screen.findByRole("button", { name: "撤销链接" });
  await user.click(screen.getByRole("button", { name: "撤销链接" }));
  await screen.findByText("链接已撤销，后续访问立即失效。");
  expect(screen.queryByLabelText("公开链接")).not.toBeInTheDocument();
  client.clear();
});

it("rewrites only in-scope note links while assembling paged nested blocks", () => {
  const allowed = new Set([rootId, childId]);
  expect(
    sharedNoteLink(
      `orbis-note:${childId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe(`https://orbis.example/share/${token}/${childId}`);
  expect(
    sharedNoteLink(
      `orbis-note:${bookId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe("");
  const root = page("");
  expect(
    sharedNoteLink(
      `/documents/${childId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe(`https://orbis.example/share/${token}/${childId}`);
  expect(
    sharedNoteLink(
      `https://orbis.example/documents/${childId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe(`https://orbis.example/share/${token}/${childId}`);
  expect(
    sharedNoteLink(
      `https://orbis.example/documents/${bookId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe("");
  expect(
    sharedNoteLink(
      `https://external.example/documents/${childId}`,
      token,
      allowed,
      "https://orbis.example",
    ),
  ).toBe(`https://external.example/documents/${childId}`);
  root.blocks.blocks = [
    { id: "quote", type: "quote", props: {}, content: "", children: [] },
  ];
  const child = { ...page("Nested"), parent_id: "quote" };
  const blocks = hydratedSharedBlocks(
    [root, child],
    manifest,
    token,
    "https://orbis.example",
  );
  expect(blocks.blocks[0].children).toEqual([
    expect.objectContaining({ content: "Nested" }),
  ]);
});
