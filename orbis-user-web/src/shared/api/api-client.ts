type RequestBody = BodyInit | Record<string, unknown> | unknown[] | null;

export type ApiRequestOptions = {
  method?: string;
  token?: string | null;
  refreshToken?: string | null;
  body?: RequestBody;
  headers?: HeadersInit;
  onTokenRefresh?: (accessToken: string) => void;
  onUnauthorized?: () => void;
};

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly isConflict: boolean;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.isConflict = status === 409;
  }
}

const DEFAULT_API_BASE_URL = "/api";

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (configured || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function isBodyInit(body: RequestBody): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  );
}

function createRequestInit(options: ApiRequestOptions, token: string | null | undefined): RequestInit {
  const headers = toHeaderRecord(options.headers);
  let body: BodyInit | undefined;

  if (options.body !== undefined && options.body !== null) {
    if (isBodyInit(options.body)) {
      body = options.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return {
    method: options.method ?? "GET",
    headers,
    body,
  };
}

async function parseErrorDetail(response: Response): Promise<string> {
  const fallback = "请求失败";
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return fallback;
  }

  try {
    const payload = (await response.json()) as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : fallback;
  } catch {
    return fallback;
  }
}

async function parseSuccess<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const response = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { access_token?: unknown };
  return typeof payload.access_token === "string" ? payload.access_token : null;
}

async function handleError(response: Response, options: ApiRequestOptions): Promise<never> {
  if (response.status === 401) {
    options.onUnauthorized?.();
  }
  throw new ApiError(response.status, await parseErrorDetail(response));
}

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, createRequestInit(options, options.token));

  if (!response.ok) {
    if (response.status === 401 && options.refreshToken) {
      const nextAccessToken = await refreshAccessToken(options.refreshToken);
      if (nextAccessToken) {
        options.onTokenRefresh?.(nextAccessToken);
        const retryResponse = await fetch(`${apiBaseUrl()}${path}`, createRequestInit(options, nextAccessToken));
        if (retryResponse.ok) {
          return parseSuccess<T>(retryResponse);
        }
        return handleError(retryResponse, options);
      }
    }

    return handleError(response, options);
  }

  return parseSuccess<T>(response);
}
