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
  readonly code: string;
  readonly requestId: string;
  readonly data: unknown;
  readonly isConflict: boolean;

  constructor(
    status: number,
    message: string,
    code = "UNKNOWN_ERROR",
    requestId = "",
    data: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.data = data;
    this.isConflict = status === 409;
  }
}

type ApiEnvelope<T> = {
  code: string;
  message: string;
  request_id: string;
  data: T;
};

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

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const payload = (await response.json()) as Partial<ApiEnvelope<T>>;
    if (
      typeof payload.code !== "string" ||
      typeof payload.message !== "string" ||
      typeof payload.request_id !== "string" ||
      !("data" in payload)
    ) {
      return null;
    }
    return payload as ApiEnvelope<T>;
  } catch {
    return null;
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

  const envelope = await parseEnvelope<T>(response);
  return envelope?.data as T;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const envelope = await parseEnvelope<{ access_token?: unknown }>(response);
  const payload = envelope?.data;
  return typeof payload?.access_token === "string" ? payload.access_token : null;
}

async function handleError(response: Response, options: ApiRequestOptions): Promise<never> {
  if (response.status === 401) {
    options.onUnauthorized?.();
  }
  const envelope = await parseEnvelope<unknown>(response);
  throw new ApiError(
    response.status,
    envelope?.message ?? "请求失败",
    envelope?.code ?? "UNKNOWN_ERROR",
    envelope?.request_id ?? response.headers.get("X-Request-ID") ?? "",
    envelope?.data ?? null,
  );
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
