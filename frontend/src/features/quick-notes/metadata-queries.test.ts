import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { quickNoteSummaryQueryOptions, quickNoteTagsQueryOptions } from "./metadata-queries";

const workspaceA = "00000000-0000-4000-8000-000000000021";
const workspaceB = "00000000-0000-4000-8000-000000000022";
const authA: AuthRequestOptions = {
  accessToken: "metadata-a", refreshToken: null, workspaceId: workspaceA,
  onTokenRefresh() {}, onUnauthorized() {},
};
const authB: AuthRequestOptions = { ...authA, accessToken: "metadata-b", workspaceId: workspaceB };

function installMetadataResponses() {
  let revision = 1;
  const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input), "http://orbis.test");
    const match = /^\/api\/v1\/workspaces\/([^/]+)\/(quick-note-tags|quick-notes\/summary)$/.exec(url.pathname);
    if (!match) throw new Error(`Unexpected metadata request: ${url}`);
    const [, workspace, endpoint] = match;
    expect([workspaceA, workspaceB]).toContain(workspace);
    const first = workspace === workspaceA;
    expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${first ? authA.accessToken : authB.accessToken}`);
    const data = endpoint === "quick-notes/summary"
      ? { total: first ? revision : 9, untagged: 0, deleted: 0, server_only: true }
      : { items: [{ id: workspace, name: first ? `A标签${revision}` : "B标签", version: revision, count: 1, created_at_ms: 1, updated_at_ms: 1 }], pagination: { page: 1, page_size: 100, total: 1 } };
    if (endpoint === "quick-note-tags") expect(url.searchParams.get("page_size")).toBe("100");
    return new Response(JSON.stringify({ code: "OK", message: "", request_id: "metadata-test", data }), { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, updateFirstWorkspace: () => { revision += 1; } };
}

afterEach(() => vi.unstubAllGlobals());

it("shares same-scope metadata requests and invalidates only the current workspace scope", async () => {
  const { fetchMock, updateFirstWorkspace } = installMetadataResponses();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: Infinity } } });
  const tagsA = quickNoteTagsQueryOptions(authA, "session-a"), summaryA = quickNoteSummaryQueryOptions(authA, "session-a");
  const tagsB = quickNoteTagsQueryOptions(authB, "session-b"), summaryB = quickNoteSummaryQueryOptions(authB, "session-b");
  const observers = [
    tagsA, summaryA,
    quickNoteTagsQueryOptions({ ...authA }, "session-a"),
    quickNoteSummaryQueryOptions({ ...authA }, "session-a"),
    tagsB, summaryB,
  ].map(options => new QueryObserver<unknown>(client, options));
  try {
    observers.forEach(observer => observer.subscribe(() => {}));
    await waitFor(() => observers.forEach(observer => expect(observer.getCurrentResult().isSuccess).toBe(true)));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(client.getQueryCache().getAll()).toHaveLength(4);
    expect(client.getQueryData(summaryA.queryKey)).toEqual({ total: 1, untagged: 0, deleted: 0 });
    expect(client.getQueryData(summaryB.queryKey)).toEqual({ total: 9, untagged: 0, deleted: 0 });
    expect(client.getQueryData(tagsA.queryKey)).toMatchObject({ items: [{ id: workspaceA, name: "A标签1" }] });
    expect(client.getQueryData(tagsB.queryKey)).toMatchObject({ items: [{ id: workspaceB, name: "B标签" }] });

    const otherSummary = client.getQueryData(summaryB.queryKey), otherTags = client.getQueryData(tagsB.queryKey);
    updateFirstWorkspace();
    await client.invalidateQueries({ queryKey: ["quick-notes", "session-a"] });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.slice(4).map(([url]) => new URL(String(url), "http://orbis.test").pathname).sort()).toEqual([
      `/api/v1/workspaces/${workspaceA}/quick-note-tags`,
      `/api/v1/workspaces/${workspaceA}/quick-notes/summary`,
    ].sort());
    expect(client.getQueryData(summaryA.queryKey)).toEqual({ total: 2, untagged: 0, deleted: 0 });
    expect(client.getQueryData(tagsA.queryKey)).toMatchObject({ items: [{ id: workspaceA, name: "A标签2" }] });
    expect(client.getQueryData(summaryB.queryKey)).toBe(otherSummary);
    expect(client.getQueryData(tagsB.queryKey)).toBe(otherTags);
  } finally {
    observers.forEach(observer => observer.destroy());
    client.clear();
  }
});

it("preserves QueryClient defaults instead of enabling reads or overriding fetch policies", async () => {
  const { fetchMock } = installMetadataResponses();
  const defaults = { enabled: false, retry: false, staleTime: 60_000, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
  const client = new QueryClient({ defaultOptions: { queries: defaults } });
  const options = [quickNoteTagsQueryOptions(authA, "session-a"), quickNoteSummaryQueryOptions(authA, "session-a")];
  const observers = options.map(option => new QueryObserver<unknown>(client, option));
  try {
    observers.forEach(observer => observer.subscribe(() => {}));
    expect(fetchMock).not.toHaveBeenCalled();
    for (const option of options) expect(client.getQueryCache().find({ queryKey: option.queryKey })?.options).toMatchObject(defaults);
    await Promise.all(observers.map(observer => observer.refetch()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(options[1].queryKey)).toEqual({ total: 1, untagged: 0, deleted: 0 });
    observers.forEach(observer => expect(observer.getCurrentResult().isSuccess).toBe(true));
  } finally {
    observers.forEach(observer => observer.destroy());
    client.clear();
  }
});
