import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useNote, useNoteContent, useNotebook, useUpdateNote } from "../../src/features/documents/queries";
import { authStore } from "../../src/shared/auth/auth-store";

const id = "0190a111-1111-7111-8111-111111111111";
const notebook = { id, title: "Notebook", tenant_id: null, workspace_id: id, owner_id: id, group_id: id, status: "active", sort_order: 0, icon: null, created_at_ms: 1, updated_at_ms: 1 };
function setup() {
  authStore.setState({ accessToken: "local-test", refreshToken: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); authStore.getState().clearSession(); });

it.each([useNote, useNoteContent, useNotebook])("cancels an obsolete editor read at fetch", async (hook) => {
  const { wrapper } = setup();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    requestSignal = options.signal as AbortSignal;
    requestSignal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
  })));
  const view = renderHook(() => hook(id), { wrapper });
  await waitFor(() => expect(requestSignal).toBeDefined());
  view.unmount();
  expect(requestSignal?.aborted).toBe(true);
});

it("loads current notebook metadata directly without enumerating the workspace", async () => {
  const { wrapper } = setup();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "OK", message: "ok", request_id: "test", data: notebook }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const view = renderHook(() => useNotebook(id), { wrapper });
  await waitFor(() => expect(view.result.current.data?.title).toBe("Notebook"));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(`/api/notebooks/${id}`);
});

it("finishes a title save without waiting for background directory refreshes", async () => {
  const { client, wrapper } = setup();
  const note = { ...notebook, notebook_id: id, parent_id: null, note_type: "document", title: "Renamed" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "OK", message: "ok", request_id: "test", data: note }), { headers: { "Content-Type": "application/json" } })));
  const invalidation = vi.spyOn(client, "invalidateQueries").mockReturnValue(new Promise(() => {}));
  client.setQueryData(["note-tree", id], { items: [{ ...note, title: "Old", children: [] }] });
  const { result } = renderHook(() => useUpdateNote(), { wrapper });
  await act(async () => { await result.current.mutateAsync({ id, title: "Renamed" }); });
  expect(client.getQueryData(["note-tree", id])).toMatchObject({ items: [{ title: "Renamed" }] });
  expect(invalidation.mock.calls.every(([options]) => options?.queryKey?.[0] !== "notebooks" && options?.queryKey?.[0] !== "document-groups")).toBe(true);
});
