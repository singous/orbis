import { isRequestCancelled, markErrorHandled, requestFailed, requestSucceeded, type RequestFeedback } from "./request-feedback";
export { reportError, withRequestFeedback } from "./request-feedback";
type RequestBody = BodyInit | Record<string, unknown> | unknown[] | null;
export type SessionTokens = { accessToken: string; refreshToken: string };
export type ApiRequestOptions = {
  method?: string;
  token?: string | null;
  refreshToken?: string | null;
  workspaceId?: string | null;
  body?: RequestBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
  feedback?: RequestFeedback;
  canNotify?: () => boolean;
  onTokenRefresh?: (accessToken: string, refreshToken: string) => void;
  onUnauthorized?: () => void;
  refreshCoordinator?: (refresh: () => Promise<SessionTokens | null>) => Promise<SessionTokens | null>;
};
export class ApiError extends Error {
  readonly isConflict: boolean;
  constructor(readonly status: number, message: string, readonly code = "UNKNOWN_ERROR", readonly requestId = "", readonly data: unknown = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.isConflict = status === 409;
  }
}
type ApiEnvelope<T> = { code: string; message: string; request_id: string; data: T };
function apiBaseUrl(): string {
  return ((import.meta.env.VITE_API_BASE_URL as string | undefined) || "/api").replace(/\/$/, "");
}
export function workspacePath(auth: { workspaceId?: string | null }, path: string): string {
  if (!auth.workspaceId) throw new ApiError(400, "请先选择工作空间", "WORKSPACE_REQUIRED");
  return `/v1/workspaces/${encodeURIComponent(auth.workspaceId)}${path}`;
}
function headersRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => { result[key] = value; });
  return result;
}
function requestInit(options: ApiRequestOptions, token?: string | null): RequestInit {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    const value = options.body;
    if (typeof value === "string" || value instanceof Blob || value instanceof FormData || value instanceof URLSearchParams || value instanceof ArrayBuffer) body = value;
    else { headers.set("Content-Type", "application/json"); body = JSON.stringify(value); }
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { method: options.method ?? "GET", headers: headersRecord(headers), body, signal: options.signal, cache: options.cache, redirect: "error" };
}
async function envelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  if (!response.headers.get("Content-Type")?.includes("application/json")) return null;
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<ApiEnvelope<T>>;
    return typeof item.code === "string" && typeof item.message === "string" && typeof item.request_id === "string" && "data" in item ? item as ApiEnvelope<T> : null;
  } catch { return null; }
}
const SUCCESS_CODES = new Set(["OK", "CREATED", "ACCEPTED"]);
async function jsonSuccess<T>(response: Response, options: ApiRequestOptions = {}): Promise<T> {
  if (response.status === 204) { requestSucceeded(options, "操作成功"); return undefined as T; }
  const value = await envelope<T>(response);
  options.signal?.throwIfAborted();
  if (!value) throw new ApiError(502, "服务返回了无效响应，请重试", "API_RESPONSE_INVALID", response.headers.get("X-Request-ID") ?? "");
  if (!SUCCESS_CODES.has(value.code)) throw new ApiError(response.status, value.message || "请求失败", value.code, value.request_id, value.data);
  requestSucceeded(options, value.message || "操作成功");
  return value.data;
}

// A short bounded cache covers concurrent and delayed 401 responses to a rotating credential.
const refreshes = new Map<string, { expires: number; promise: Promise<SessionTokens | null> }>();
const REFRESH_CACHE_MS = 60_000;
const MAX_REFRESH_CACHE = 32;
function refreshTokens(token: string): Promise<SessionTokens | null> {
  const now = Date.now();
  for (const [key, entry] of refreshes) if (entry.expires <= now) refreshes.delete(key);
  const current = refreshes.get(token);
  if (current) return current.promise;
  if (refreshes.size >= MAX_REFRESH_CACHE) {
    return Promise.reject(new ApiError(503, "会话刷新繁忙，请稍后重试", "AUTH_REFRESH_BUSY"));
  }
  const promise = (async () => {
    // The rotation must finish independently of one canceled reader so its new credential can be persisted.
    const response = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: token }),
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (response.status === 401) return null;
    if (!response.ok) {
      const error = await envelope<unknown>(response);
      throw new ApiError(response.status, error?.message ?? "会话刷新失败，请重试", error?.code ?? "AUTH_REFRESH_FAILED", error?.request_id ?? "");
    }
    const data = await jsonSuccess<{ access_token: string; refresh_token: string }>(response);
    if (typeof data?.access_token !== "string" || typeof data.refresh_token !== "string") throw new ApiError(502, "会话响应不完整，请重试", "API_RESPONSE_INVALID");
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  })();
  refreshes.set(token, { expires: now + REFRESH_CACHE_MS, promise });
  // Transient failures must not poison the credential for the cache lifetime.
  void promise.catch(() => { if (refreshes.get(token)?.promise === promise) refreshes.delete(token); });
  return promise;
}
async function fail(response: Response): Promise<never> {
  const value = await envelope<unknown>(response);
  throw new ApiError(response.status, value?.message ?? "请求失败", value?.code ?? "UNKNOWN_ERROR", value?.request_id ?? response.headers.get("X-Request-ID") ?? "", value?.data ?? null);
}
async function request<T>(path: string, options: ApiRequestOptions, parse: (response: Response, options: ApiRequestOptions) => Promise<T>, publicSite = false): Promise<T> {
  const captured = { ...options, headers: headersRecord(options.headers) };
  try {
    if (!path.startsWith(publicSite ? "/s/" : "/v1/") || path.includes("\\") || path.split(/[/?]/).some(part => part === ".." || part === ".")) throw new ApiError(400, "接口路径不正确", "API_PATH_INVALID");
    const url = publicSite ? path : `${apiBaseUrl()}${path}`;
    let response = await fetch(url, requestInit(captured, captured.token));
    if (response.status === 401 && captured.refreshToken) {
      const rotate = () => refreshTokens(captured.refreshToken!);
      const tokens = await (captured.refreshCoordinator ? captured.refreshCoordinator(rotate) : rotate());
      if (tokens) {
        captured.onTokenRefresh?.(tokens.accessToken, tokens.refreshToken);
        captured.signal?.throwIfAborted();
        response = await fetch(url, requestInit(captured, tokens.accessToken));
      }
    }
    if (!response.ok) return await fail(response);
    return await parse(response, captured);
  } catch (cause) {
    if (captured.signal?.aborted || isRequestCancelled(cause)) { markErrorHandled(cause); throw cause; }
    // 网络中断没有 HTTP 状态，保留 TypeError 分类，避免业务层将其当成已被服务器拒绝的请求。
    const error = cause instanceof TypeError ? new TypeError("网络异常，请稍后重试", { cause }) : cause;
    const allowed = captured.canNotify?.() !== false;
    const unauthorized = error instanceof ApiError && error.status === 401;
    if (unauthorized) captured.onUnauthorized?.();
    requestFailed(captured, error, allowed, unauthorized);
    throw error;
  }
}
export function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> { return request(path, options, jsonSuccess<T>); }
export function apiBlobRequest(path: string, options: ApiRequestOptions = {}): Promise<Blob> { return request(path, options, response => response.blob()); }
export function publicMarkdownRequest(path: string, signal?: AbortSignal): Promise<string> {
  return request(path, { signal, cache: "no-store" }, async response => {
    if (!/^text\/(markdown|plain)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new ApiError(502, "未收到有效的页面 Markdown", "API_RESPONSE_INVALID");
    return response.text();
  }, true);
}
