import { vi } from "vitest";

export const NOTE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
export const USER_ID = "018ff7c4-a5b6-7000-8000-000000000002";
export const OTHER_ID = "018ff7c4-a5b6-7000-8000-000000000003";
export const COMMENT_ID = "018ff7c4-a5b6-7000-8000-000000000004";
export const REVISION_ID = "018ff7c4-a5b6-7000-8000-000000000005";
export const NEXT_ID = "018ff7c4-a5b6-7000-8000-000000000006";
export const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000007";
export const NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000008";
export const blocks = (text: string) => ({ schema_version: 2 as const, editor: "blocknote" as const, blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] }] });
export const content = (version = 4, text = "当前正文") => ({ note_id: NOTE_ID, blocks: blocks(text), plain_text: text, content_version: version, created_at_ms: 1, updated_at_ms: 1 });
export const comment = (body = "第一条讨论") => ({ id: COMMENT_ID, note_id: NOTE_ID, parent_id: null as string | null, author_id: USER_ID, author_name: "作者", body, is_resolved: false, created_at_ms: 1, updated_at_ms: 1 });
export const revision = { id: REVISION_ID, content_version: 2, author_name: "作者", created_at_ms: 1 };
export const session = { accessToken: "access", refreshToken: "refresh", user: { id: USER_ID, tenant_id: null, email: "author@orbis.test", display_name: "作者", current_workspace_id: WORKSPACE_ID, status: "active", created_at_ms: 1, updated_at_ms: 1 }, workspace: { id: WORKSPACE_ID, name: "团队", workspace_type: "team", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 } };
export function page<T>(items: T[], pageNumber = 1, hasNext = false) {
  return { items, pagination: { page: pageNumber, page_size: 20, total: items.length + (hasNext ? 1 : 0), total_pages: hasNext ? pageNumber + 1 : pageNumber, has_next: hasNext, has_previous: pageNumber > 1 } };
}
export function response(data: unknown, status = 200, message = "ok") {
  return new Response(JSON.stringify({ code: status === 409 ? "NOTE_VERSION_CONFLICT" : status >= 400 ? "REQUEST_FAILED" : "OK", message, request_id: "test-request", data }), { status, headers: { "Content-Type": "application/json" } });
}
export function http(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const requests: { path: string; method: string; body: Record<string, unknown> | null; headers: Headers }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    const url = new URL(path, "http://localhost");
    requests.push({ path: url.pathname + url.search, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init.headers) });
    return handler(url, init);
  }));
  return requests;
}
