type RequestBody = BodyInit | Record<string, unknown> | unknown[] | null;

export type ApiRequestOptions = {
  method?: string;
  token?: string | null;
  body?: RequestBody;
  headers?: HeadersInit;
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

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
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

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (!response.ok) {
    if (response.status === 401) {
      options.onUnauthorized?.();
    }
    throw new ApiError(response.status, await parseErrorDetail(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
