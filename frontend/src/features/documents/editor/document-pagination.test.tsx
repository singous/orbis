import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { authStore } from "../../../shared/auth/auth-store";
import type { NoteBlocksV2 } from "../../content/blocks";
import { NOTE_ID, NOTEBOOK_ID, http, page, response, session } from "../../collaboration/collaboration.test-utils";
import { nativeCollection, nativeDocument, nativeSnapshot } from "./editor.test-utils";
import { LegacyDocumentEditorPage } from "./LegacyDocumentEditorPage";
import type { EditorContentHandle } from "./editor-content-handle";
import { reportRequestError } from "../../../shared/api/request-feedback";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/ui/Toast", () => ({ showToast: notify }));
vi.mock("../DocumentShell", () => ({ DocumentShell: ({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("./TiptapEditor", () => ({ TiptapEditor: ({ blocks, onContentReady, ensureComplete }: { ensureComplete?: () => Promise<void>; blocks: NoteBlocksV2; onContentReady: (handle: EditorContentHandle | null) => void }) => {
  const content = useRef(blocks);
  const [live, setLive] = useState(blocks);
  useEffect(() => {
    onContentReady({
      snapshot: () => content.current,
      append: additions => {
        content.current = { ...content.current, blocks: [...content.current.blocks, ...additions] };
        setLive(content.current);
        return content.current;
      },
      appendChildren: () => content.current,
      hydratePayload: () => content.current,
      selectAll: () => {}, selectEnd: () => {},
    });
    return () => onContentReady(null);
  }, []);
  return <article aria-label="正文"><button onClick={() => void ensureComplete?.().catch(reportRequestError)}>复制完整正文</button>{live.blocks.map(block => <p key={block.id}>{(block.content as { text: string }[]).map(run => run.text).join("")}</p>)}</article>;
} }));

afterEach(() => { notify.mockClear(); cleanup(); vi.unstubAllGlobals(); authStore.getState().clearSession(); });

it.each(["http", "schema"])("keeps Continue reading usable after a %s page failure and reports once across readers", async failure => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  act(() => authStore.setState(session));
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let subsequentAttempts = 0;
  const requests = http(url => {
    if (url.pathname.endsWith(`/collections/${NOTEBOOK_ID}`)) return response(nativeCollection);
    if (url.pathname.endsWith(`/documents/${NOTE_ID}`)) return response(nativeDocument);
    if (url.pathname.endsWith("/children")) {
      const next = url.searchParams.has("cursor");
      if (next && ++subsequentAttempts === 1) return failure === "http" ? response(null, 503, "后续正文暂时不可用") : response({ version: "invalid", items: [] });
      const block = nativeSnapshot(4, next ? "后续内容" : "先前内容").blocks[0];
      return response({ version: 4, items: [{
        id: next ? "018ff7c4-a5b6-7000-8000-000000000010" : block.id, parent_id: null, position: next ? 1 : 0,
        block_type: block.type, payload_loaded: true, payload_bytes: 100, block_revision: 4, child_count: 0,
        payload: { type: block.type, props: block.props, content: block.content },
      }], pagination: { next_cursor: next ? null : "next-page", has_more: !next } });
    }
    return response(page([]));
  });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}><Routes><Route path="/documents/:noteId" element={<LegacyDocumentEditorPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByText("先前内容");
  await user.click(screen.getByRole("button", { name: "复制完整正文" }));
  await waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith({ title: failure === "http" ? "后续正文暂时不可用" : "服务返回的数据不完整，请刷新重试", tone: "danger" }));
  expect(screen.getByText("先前内容")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "继续阅读" }));
  await screen.findByText("后续内容");
  expect(screen.getAllByText("先前内容")).toHaveLength(1);
  expect(screen.getAllByText("后续内容")).toHaveLength(1);
  expect(subsequentAttempts).toBe(2);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(requests.every(request => request.method === "GET")).toBe(true);
  expect(screen.queryByRole("button", { name: "继续阅读" })).not.toBeInTheDocument();
  client.clear();
});
