import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useNote, useNoteContent, useNotebook, useUpdateNote } from "../queries";
import { authStore } from "../../../shared/auth/auth-store";

const id = "0190a111-1111-7111-8111-111111111111";
const notebook = { id, title: "Notebook", tenant_id: null, workspace_id: id, owner_id: id, group_id: id, is_archived:false,archived_at_ms:null,metadata_version:1,directory_version:1, sort_order: 0, icon: null, created_at_ms: 1, updated_at_ms: 1 };
function setup() {
  authStore.setState({ accessToken: "local-test", refreshToken: null,workspace:{id,name:"测试空间",role:"owner",created_at_ms:1,updated_at_ms:1} });
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
  expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/workspaces/${id}/collections/${id}`);
});

it("finishes a title save without waiting for background directory refreshes", async () => {
  const { client, wrapper } = setup();
  const note = {...notebook,collection_id:id,content_version:2,position:0,parent_id:null,title:"Renamed"};
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async(url:string)=>new Response(JSON.stringify({code:"OK",message:"ok",request_id:"test",data:url.endsWith("/operations")?{document_id:id,operation_id:id,base_version:1,content_version:2,title:note.title,changed_block_ids:[],deleted_block_ids:[]}:note}),{headers:{"Content-Type":"application/json"}})));
  const invalidation = vi.spyOn(client, "invalidateQueries").mockReturnValue(new Promise(() => {}));
  client.setQueryData(["note-tree", id], { items: [{ ...note, title: "Old", children: [] }] });
  const { result } = renderHook(() => useUpdateNote(), { wrapper });
  await act(async () => { await result.current.mutateAsync({ id, title: "Renamed",expected_version:1,operation_id:id }); });
  expect(client.getQueryData(["note-tree", id])).toMatchObject({ items: [{ title: "Renamed" }] });
  expect(invalidation.mock.calls.every(([options]) => options?.queryKey?.[0] !== "notebooks" && options?.queryKey?.[0] !== "document-groups")).toBe(true);
});
