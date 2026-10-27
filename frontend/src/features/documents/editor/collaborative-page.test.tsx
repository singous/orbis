import { Toaster } from "../../../shared/ui/Toast";
import { useContext, useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";

import { authStore } from "../../../shared/auth/auth-store";
import { preparePendingNavigation } from "../../../shared/navigation/pending-navigation";
import { session, NOTE_ID, WORKSPACE_ID, NOTEBOOK_ID, USER_ID, http, response } from "../../collaboration/collaboration.test-utils";
import { nativeCollection, nativeDocument } from "./editor.test-utils";
import { TableHostContext, type TableHost } from "../../data-tables/context";
import { fromTiptapDocument } from "./tiptap-model";
import { decodeCollaborationUpdate, encodeCollaborationUpdate, type CollaborationState } from "./collaboration-provider";
import type { EditorContentHandle } from "./editor-content-handle";
import type { TiptapEditor } from "./TiptapEditor";
import { DocumentEditorPage } from "./DocumentEditorPage";
import { createIndexedDbDraftAdapter, draftScopeKey, withDraftLane, type DraftCheckpoint } from "./draft-checkpoints";

const harness = vi.hoisted(() => ({ hosts: [] as Array<TableHost | null>, hydrate: vi.fn() }));
vi.mock("../DocumentShell", () => ({ DocumentShell: ({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("../../sharing/ShareButton", () => ({ ShareButton: () => <button>分享</button> }));
vi.mock("./TiptapEditor", () => ({ TiptapEditor: function MockEditor({ collaborationDoc, onChange, onContentReady, readOnly }: Parameters<typeof TiptapEditor>[0]) {
  const host = useContext(TableHostContext);
  const [text, setText] = useState("");
  harness.hosts.push(host);
  const snapshot = () => fromTiptapDocument(yDocToProsemirrorJSON(collaborationDoc!, "body"));
  useEffect(() => {
    if (!collaborationDoc) return;
    const refresh = () => { setText(collaborationDoc.getXmlFragment("body").toString()); onChange({ blocks: snapshot() }); };
    refresh(); collaborationDoc.on("update", refresh);
    const handle: EditorContentHandle = { snapshot, append: () => { throw new Error("Unexpected JSON append"); }, appendChildren: () => { throw new Error("Unexpected JSON append"); }, hydratePayload: harness.hydrate, selectAll: () => {}, selectEnd: () => {} };
    onContentReady?.(handle);
    return () => { collaborationDoc.off("update", refresh); onContentReady?.(null); };
  }, [collaborationDoc]);
  return <section><output aria-label="正文">{text}</output><button disabled={readOnly || !collaborationDoc} onClick={() => {
    const paragraph = collaborationDoc!.getXmlFragment("body").get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(0, "local ");
  }}>模拟协作编辑</button></section>;
} }));

type Wire = Record<string, unknown>;
const epoch = "018ff7c4-a5b6-7000-8000-000000000020";
const blockId = "018ff7c4-a5b6-7000-8000-000000000009";
class Socket {
  readyState = 0;
  onopen: WebSocket["onopen"] = null;
  onmessage: WebSocket["onmessage"] = null;
  onerror: WebSocket["onerror"] = null;
  onclose: WebSocket["onclose"] = null;
  constructor(readonly server: Server) { server.sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, new Event("open")); }); }
  send(value: string) { this.server.receive(this, JSON.parse(value)); }
  message(value: Wire) { if (this.readyState === 1) this.onmessage?.call(this as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify(value) })); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, new CloseEvent("close")); }
}
class Server {
  doc = new Y.Doc({ gc: false });
  version = 4;
  title = "产品计划";
  acknowledge = true;
  rejectUpdates = false;
  loseTitleResponse = false;
  titleReceipts = new Map<string, Record<string, unknown>>();
  sockets: Socket[] = [];
  updates: Array<{ socket: Socket; message: Wire; version: number }> = [];
  constructor() {
    const paragraph = new Y.XmlElement("paragraph"); paragraph.setAttribute("orbisId", blockId);
    const text = new Y.XmlText(); text.insert(0, "当前正文"); paragraph.insert(0, [text]); this.doc.getXmlFragment("body").insert(0, [paragraph]);
  }
  state(): CollaborationState { return { document_id: NOTE_ID, epoch, protocol_version: 1, content_version: this.version, state: encodeCollaborationUpdate(Y.encodeStateAsUpdate(this.doc)), updated_at_ms: 1 }; }
  receive(socket: Socket, value: Wire) {
    if (value.type === "authenticate") { queueMicrotask(() => socket.message({ type: "state", data: this.state() })); return; }
    if (value.type !== "update") return;
    if (this.rejectUpdates) { queueMicrotask(() => socket.message({ type: "error", status: 409, code: "COLLABORATION_TARGET_REMOVED", message: "目标已被并发移动或删除" })); return; }
    Y.applyUpdate(this.doc, decodeCollaborationUpdate(String(value.update)));
    this.version += 1;
    this.updates.push({ socket, message: value, version: this.version });
    for (const peer of this.sockets) queueMicrotask(() => peer.message({ type: "state", data: this.state() }));
    if (this.acknowledge) this.ack();
  }
  ack() { for (const update of this.updates) update.socket.message({ type: "ack", epoch, operation_id: update.message.operation_id, content_version: update.version }); }
}
let server: Server;
let requests: ReturnType<typeof http>;
beforeEach(() => {
  server = new Server(); harness.hosts = []; harness.hydrate.mockClear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("WebSocket", class extends Socket { constructor(_url: string) { super(server); } });
  requests = http((url, init) => {
    if (url.pathname.endsWith(`/documents/${NOTE_ID}`)) return response({ ...nativeDocument, title: server.title, content_version: server.version, collaboration_available: true });
    if (url.pathname.endsWith("/collaboration")) return response(server.state());
    if (url.pathname.endsWith(`/collections/${NOTEBOOK_ID}`)) return response(nativeCollection);
    if (url.pathname.endsWith("/operations") && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const receipt = server.titleReceipts.get(body.operation_id);
      if (receipt) return response(receipt);
      if (body.expected_version !== server.version) return response(null, 409, "版本冲突");
      for (const operation of body.operations) {
        if (operation.type !== "update_metadata") throw new Error("Collaborative body leaked into native commands");
        server.title = operation.title;
      }
      server.version += 1;
      const committed = { document_id: NOTE_ID, operation_id: body.operation_id, base_version: body.expected_version, content_version: server.version, title: server.title, changed_block_ids: [], deleted_block_ids: [] };
      server.titleReceipts.set(body.operation_id, committed);
      if (server.loseTitleResponse) { server.loseTitleResponse = false; throw new TypeError("Lost response after title commit"); }
      return response(committed);
    }
    throw new Error(`Unexpected collaboration page request: ${init.method ?? "GET"} ${url.pathname}`);
  });
  act(() => authStore.getState().setSession(session));
});
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  server.doc.destroy();
  act(() => authStore.getState().clearSession());
  localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter><Toaster /></QueryClientProvider>), client };
}

it("uses the CRDT body without native JSON paging and shows saved only after durable ACK", async () => {
  server.acknowledge = false;
  const view = open();
  const edit = await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  expect(requests.some(request => request.path.includes("/children"))).toBe(false);
  expect(requests.filter(request => request.path.endsWith("/collaboration")).map(request => request.method)).toEqual(["POST"]);
  fireEvent.click(edit);
  await waitFor(() => expect(server.updates).toHaveLength(1));
  expect(within(view.container).queryByText("已保存")).not.toBeInTheDocument();
  expect(requests.some(request => request.method === "POST" && request.path.endsWith("/operations"))).toBe(false);
  act(() => server.ack());
  expect(await within(view.container).findByText("已保存")).toBeInTheDocument();
});

it("synchronizes two mounted pages and flushes pending content before navigation", async () => {
  const first = open(), second = open();
  const edit = await within(first.container).findByRole("button", { name: "模拟协作编辑" });
  await within(second.container).findByRole("button", { name: "模拟协作编辑" });
  server.acknowledge = false;
  fireEvent.click(edit);
  let complete = false;
  const pending = preparePendingNavigation().then(() => { complete = true; });
  await waitFor(() => expect(server.updates.length).toBeGreaterThan(0));
  expect(complete).toBe(false);
  await waitFor(() => expect(within(second.container).getByLabelText("正文")).toHaveTextContent("local 当前正文"));
  await act(async () => { server.ack(); await pending; });
  expect(complete).toBe(true);
});

it("saves titles with the durable body version and never sends body commands", async () => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  fireEvent.click(within(view.container).getByRole("button", { name: "模拟协作编辑" }));
  fireEvent.change(within(view.container).getByRole("textbox", { name: "文档标题" }), { target: { value: "协作标题" } });
  await waitFor(() => expect(server.title).toBe("协作标题"), { timeout: 3000 });
  const write = requests.find(request => request.path.endsWith("/operations"))!;
  expect(write.body?.expected_version).toBe(5);
  expect(write.body?.operations).toEqual([{ type: "update_metadata", title: "协作标题" }]);
  expect(requests.some(request => request.path.endsWith("/content") || request.path.includes("/children"))).toBe(false);
});

it("reads existing collaboration for viewers without activation or writes", async () => {
  act(() => authStore.setState({ workspace: { ...session.workspace, role: "viewer" } }));
  const view = open();
  expect(await within(view.container).findByRole("button", { name: "模拟协作编辑" })).toBeDisabled();
  expect(requests.filter(request => request.path.endsWith("/collaboration")).map(request => request.method)).toEqual(["GET"]);
  expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveAttribute("readonly");
  expect(server.updates).toHaveLength(0);
});

it("synchronizes native table commits through the provider without JSON hydration", async () => {
  open();
  await screen.findByRole("button", { name: "模拟协作编辑" });
  const host = harness.hosts.at(-1)!;
  await act(async () => {
    await host!.transact!(async version => {
      expect(version).toBe(4);
      const paragraph = server.doc.getXmlFragment("body").get(0) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "table "); server.version += 1;
      return { content_version: server.version, table_revision: 2, table_id: NOTE_ID, block: { id: blockId, type: "dataTable", props: { table_id: NOTE_ID, table_revision: 2 }, content: [], children: [] }, inverse: {} };
    });
  });
  expect(await screen.findByLabelText("正文")).toHaveTextContent("table 当前正文");
  expect(harness.hydrate).not.toHaveBeenCalled();
  expect(requests.some(request => request.path.endsWith("/collaboration") && request.method === "GET")).toBe(true);
});

it("refreshes a peer's committed title without replacing the live body", async () => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  await act(async () => {
    server.title = "另一位作者的标题"; server.version += 1;
    for (const socket of server.sockets) socket.message({ type: "state", data: server.state() });
  });
  await waitFor(() => expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue("另一位作者的标题"), { timeout: 3000 });
  expect(within(view.container).getByLabelText("正文")).toHaveTextContent("当前正文");
  expect(harness.hydrate).not.toHaveBeenCalled();
});

it("adopts a directory rename cached before its socket version and ignores older metadata", async () => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  const input = within(view.container).getByRole("textbox", { name: "文档标题" });
  act(() => {
    server.title = "目录重命名"; server.version += 1;
    view.client.setQueryData(["note", NOTE_ID], { ...nativeDocument, title: server.title, content_version: server.version, collaboration_available: true });
  });
  await waitFor(() => expect(input).toHaveValue("目录重命名"));
  act(() => {
    for (const socket of server.sockets) socket.message({ type: "state", data: server.state() });
    view.client.setQueryData(["note", NOTE_ID], { ...nativeDocument, title: "迟到的旧标题", content_version: server.version - 1, collaboration_available: true });
  });
  expect(input).toHaveValue("目录重命名");
  fireEvent.change(input, { target: { value: "本机未保存标题" } });
  act(() => view.client.setQueryData(["note", NOTE_ID], { ...nativeDocument, title: "新的目录标题", content_version: server.version + 1, collaboration_available: true }));
  expect(input).toHaveValue("本机未保存标题");
});

it("keeps a conflicting local title until the user explicitly loads the server title", async () => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  fireEvent.change(within(view.container).getByRole("textbox", { name: "文档标题" }), { target: { value: "本机待保存标题" } });
  server.version += 1; server.title = "已提交的远端标题";
  expect(await within(view.container).findByText("标题版本冲突", {}, { timeout: 3000 })).toBeInTheDocument();
  expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue("本机待保存标题");
  expect(await screen.findByRole("alertdialog", { name: "标题已被其他作者修改，本机标题仍保留。请载入服务端标题后再编辑。" })).toBeVisible();
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(requests.filter(request => request.path.endsWith("/operations"))).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  fireEvent.click(await screen.findByRole("button", { name: "载入服务端标题" }));
  fireEvent.click(screen.getByRole("button", { name: "替换本地标题" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "载入服务端标题" })).not.toBeInTheDocument());
  if (screen.queryByRole("dialog", { name: "本机修改" })) fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  await waitFor(() => expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue("已提交的远端标题"));
  expect(requests.filter(request => request.path.endsWith("/operations"))).toHaveLength(0);
});

it("does not overwrite a peer title when its socket version arrives before metadata refresh", async () => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  const input = within(view.container).getByRole("textbox", { name: "文档标题" });
  fireEvent.change(input, { target: { value: "本机待保存标题" } });
  act(() => {
    server.title = "另一位作者已保存"; server.version += 1;
    for (const socket of server.sockets) socket.message({ type: "state", data: server.state() });
  });
  expect(await within(view.container).findByText("标题版本冲突", {}, { timeout: 3000 })).toBeInTheDocument();
  expect(input).toHaveValue("本机待保存标题");
  expect(server.title).toBe("另一位作者已保存");
  expect(requests.filter(request => request.path.endsWith("/operations"))).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  fireEvent.click(await screen.findByRole("button", { name: "载入服务端标题" }));
  fireEvent.click(screen.getByRole("button", { name: "替换本地标题" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "载入服务端标题" })).not.toBeInTheDocument());
  if (screen.queryByRole("dialog", { name: "本机修改" })) fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  await waitFor(() => expect(input).toHaveValue(server.title));
});

it.each([false, true])("replays an uncertain title receipt before checking a newer metadata baseline (later input: %s)", async laterInput => {
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  server.loseTitleResponse = true;
  fireEvent.change(within(view.container).getByRole("textbox", { name: "文档标题" }), { target: { value: "结果不确定的标题" } });
  await screen.findByRole("alertdialog", { name: "网络异常，请稍后重试" }, { timeout: 3000 });
  if (laterInput) fireEvent.change(within(view.container).getByRole("textbox", { name: "文档标题" }), { target: { value: "更晚的本机输入" } });
  act(() => {
    server.title = "随后提交的标题"; server.version += 1;
    view.client.setQueryData(["note", NOTE_ID], { ...nativeDocument, title: server.title, content_version: server.version, collaboration_available: true });
    for (const socket of server.sockets) socket.message({ type: "state", data: server.state() });
  });
  expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue(laterInput ? "更晚的本机输入" : "结果不确定的标题");
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
  if (screen.queryByRole("dialog", { name: "本机修改" })) fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  await waitFor(() => expect(requests.filter(request => request.path.endsWith("/operations"))).toHaveLength(2));
  const attempts = requests.filter(request => request.path.endsWith("/operations"));
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(server.title).toBe("随后提交的标题");
  if (laterInput) {
    expect(await within(view.container).findByText("标题版本冲突")).toBeInTheDocument();
    expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue("更晚的本机输入");
  } else {
    await waitFor(() => expect(within(view.container).getByRole("textbox", { name: "文档标题" })).toHaveValue(server.title));
    expect(await within(view.container).findByText("已保存")).toBeInTheDocument();
  }
});

it("offers old JSON drafts without automatic writes and replays their original operation ID", async () => {
  const scope = draftScopeKey({ origin: new URL("/api", window.location.origin).href, userId: USER_ID, workspaceId: WORKSPACE_ID, noteId: NOTE_ID });
  const blocks = fromTiptapDocument(yDocToProsemirrorJSON(server.doc, "body"));
  const saved = { title: server.title, blocks, version: 4 }, current = { ...saved, title: "从旧草稿恢复的标题" };
  const operation = "018ff7c4-a5b6-7000-8000-000000000030";
  const record: DraftCheckpoint = { scopeKey: withDraftLane(scope, "previous-session-1234"), saved, current, window: null, descriptors: [], sequence: 7,
    pending: { format_version: 1, document_id: NOTE_ID, operation_id: operation, expected_version: 4, kind: "commands", operations: [{ type: "update_metadata", title: current.title }], submitted: current, uncertain: true },
  };
  const adapter = createIndexedDbDraftAdapter(); await adapter.put(record);
  open();
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  const restore = await screen.findByRole("button", { name: "恢复草稿" });
  expect(requests.some(request => request.path.endsWith("/operations"))).toBe(false);
  expect(await adapter.read(record.scopeKey)).not.toBeNull();
  fireEvent.click(restore);
  await waitFor(() => expect(server.title).toBe(current.title));
  expect(requests.find(request => request.path.endsWith("/operations"))?.body?.operation_id).toBe(operation);
  expect(await adapter.read(record.scopeKey)).not.toBeNull();
});

it("keeps rejected binary work exportable while opening a fresh editable server lane", async () => {
  server.rejectUpdates = true;
  const view = open();
  await within(view.container).findByRole("button", { name: "模拟协作编辑" });
  fireEvent.click(within(view.container).getByRole("button", { name: "模拟协作编辑" }));
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  const load = await screen.findByRole("button", { name: "保留本机草稿并载入服务端" });
  expect(within(view.container).getByLabelText("正文")).toHaveTextContent("local 当前正文");
  expect(server.version).toBe(4);
  server.rejectUpdates = false;
  fireEvent.click(load);
  await waitFor(() => expect(within(view.container).getByLabelText("正文")).not.toHaveTextContent("local"));
  if (screen.queryByRole("dialog", { name: "本机修改" })) fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  await waitFor(() => expect(within(view.container).getByRole("button", { name: "模拟协作编辑" })).toBeEnabled());
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  const markdown = await screen.findByRole("button", { name: /下载草稿 Markdown/ });
  const written: Blob[] = [], NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL(blob: Blob) { written.push(blob); return "blob:test"; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(markdown);
  expect(written).toHaveLength(1);
  const recovered = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(written[0]); });
  expect(recovered).toContain("local 当前正文");
  fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  fireEvent.click(within(view.container).getByRole("button", { name: "模拟协作编辑" }));
  await waitFor(() => expect(server.version).toBe(5));
  fireEvent.click(await screen.findByRole("button", { name: "本机修改" }));
  expect(screen.getByRole("button", { name: /下载草稿 Markdown/ })).toBeInTheDocument();
});
