import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { ShareButton } from "./ShareButton";
import { PublicSharePage } from "./PublicSharePage";
import {
  hydratedSharedBlocks,
  sharedNoteLink,
} from "./share-content-model";
import type {
  PublicShare,
  SharedContentPage,
} from "./api";

const rootId = "0190a111-1111-7111-8111-111111111111";
const childId = "0190a111-1111-7111-8111-111111111112";
const bookId = "0190a111-1111-7111-8111-111111111113";
const shareId = "0190a111-1111-7111-8111-111111111114";
const token = "a".repeat(43);
const blockId="0190a111-1111-7111-8111-111111111115",containerId="0190a111-1111-7111-8111-111111111116";
const manifest: PublicShare = {
  title: "团队实时资料",
  root_document_id:rootId,directory_version:1,pagination:{page:1,page_size:20,total:1,total_pages:1,has_next:false,has_previous:false},
  root_note_id: rootId,
  items: [
    {
      id: rootId,
      parent_id: null,
      title: "目录根",
      sort_order: 0,position:0,content_version:1,
      updated_at_ms: 1,
    },
    {
      id: childId,
      parent_id: rootId,
      title: "嵌套文档",
      sort_order: 0,position:0,content_version:1,
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
    next_cursor:null,
    has_more: false,
    parent_id: null,
    blocks: {
      schema_version: 2,editor:"blocknote",
      blocks: [
        { id: blockId, type: "paragraph", content: text, props: {}, children: [] },
      ],
    },
    descriptors: [
      {
        id: blockId,
        parent_id: null,
        child_count: 0,
        has_children: false,
        children_loaded: true,
        payload_loaded: true,
        payload_bytes: 32,
      },
    ],

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
function readerResponse(url:string,content:SharedContentPage,directory:PublicShare){
  const path=new URL(url,"http://orbis.test");
  if(path.pathname.endsWith("/directory")){
    const parent=path.searchParams.get("parent_id");const items=directory.items.filter(item=>item.parent_id===parent);
    return response({...directory,items,pagination:{page:1,page_size:20,total:items.length}});
  }
  const id=path.pathname.split("/documents/")[1]?.split("/")[0];
  if(!id||!directory.items.some(item=>item.id===id))return response(null,404,"SHARE_NOT_FOUND");
  const document={id,title:content.title,content_version:content.content_version,updated_at_ms:content.updated_at_ms};
  if(path.pathname.endsWith(`/documents/${id}`))return response(document);
  if(!path.pathname.endsWith("/children"))throw new Error(`Unexpected share path: ${url}`);
  return response({document,items:content.blocks.blocks.map((block,index)=>{
    const descriptor=content.descriptors[index];return {id:block.id,parent_id:content.parent_id,position:index,block_type:block.type,child_count:descriptor.child_count,payload_loaded:descriptor.payload_loaded,payload_bytes:descriptor.payload_bytes,block:descriptor.payload_loaded?{...block,content:typeof block.content==="string"?[{text:block.content,marks:[],href:null}]:block.content}:null};
  }),pagination:{next_cursor:content.next_cursor,has_more:content.has_more}});
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
    return readerResponse(url,current,manifest);
  });
  vi.stubGlobal("fetch", fetchMock);
  publicReader(client);
  await screen.findByText("刚写入的在线正文");
  await userEvent.click(screen.getByRole("button",{name:"展开目录根子目录"}));
  expect(await screen.findByRole("link", { name: "嵌套文档" })).toHaveAttribute(
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
    fetchMock.mock.calls.filter(([url]) => url.includes("/children?")).length,
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
        : readerResponse(url,page("撤销前可读正文"),manifest),
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
      readerResponse(url,page("移出前可读正文"),currentManifest),
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
    ...manifest,directory_version:2,
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
      id: containerId,
      type: "quote",
      props: {},
      content: "容器正文",
      children: [],
    },
  ];
  first.descriptors = [
    {
      id: containerId,
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
    parent_id: containerId,
    descriptors: [{ ...page("").descriptors[0], parent_id: containerId }],
  };
  const fetchMock = vi.fn(async (url: string) =>
    readerResponse(url,url.includes(`parent_id=${containerId}`)?child:first,manifest),
  );
  vi.stubGlobal("fetch", fetchMock);
  publicReader(client);
  await screen.findByText("容器正文");
  expect(
    fetchMock.mock.calls.some(([url]) => url.includes(`parent_id=${containerId}`)),
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
  authStore.setState({ accessToken: "owner-token", refreshToken: null,workspace:{id:bookId,name:"工作空间",role:"owner",created_at_ms:1,updated_at_ms:1} });
  let shares: unknown[] = [];
  const created = {
    id: shareId,
    collection_id: bookId,root_document_id:rootId,version:1,expires_at_ms:null,
    created_at_ms: 1,
    revoked_at_ms: null,
    token,
    path: `/share/${token}`,
  };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer owner-token");
    if (options?.method === "POST" && url === `/api/v1/workspaces/${bookId}/shares`) {
      expect(JSON.parse(String(options.body))).toMatchObject({
        acknowledge_public_scope: true,
        root_document_id: rootId,
      });
      shares = [created];
      return response({share:created,token,path:created.path}, 201);
    }
    if (url.endsWith("/revoke")) {
      shares = [{ ...created, revoked_at_ms: 2 }];
      return response(shares[0]);
    }
    return response({ items: shares,pagination:{page:1,page_size:100,total:shares.length} });
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
  await user.click(screen.getByRole("button", { name: "关闭" }));
  await user.click(screen.getByRole("button", { name: "分享" }));
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
    { id: containerId, type: "quote", props: {}, content: "", children: [] },
  ];
  const child = { ...page("Nested"), parent_id: containerId };
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
