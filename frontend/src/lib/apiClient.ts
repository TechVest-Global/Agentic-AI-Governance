// Minimal typed fetch client for the governance backend.
// Base URL comes from VITE_API_BASE_URL (see .env.example); defaults to local backend.
// Mock-only until the backend is running — see INTEGRATION.md.

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const API_PREFIX = "/api/v1";

function resolveBaseUrl(): string {
  const fromEnv = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL;
  return (fromEnv && fromEnv.trim()) || DEFAULT_BASE_URL;
}

export const API_BASE_URL = resolveBaseUrl();

// Backend error envelope shape (backend/app/schemas/error.py).
export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
  detail?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: ApiErrorBody;

  constructor(status: number, message: string, code?: string, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Thrown when the backend is unreachable (offline, CORS-blocked, DNS, etc.).
export class ApiNetworkError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

type QueryValue = string | number | boolean | undefined | null;
type RequestOptions = {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  let message = `Request failed with status ${response.status}`;
  let code: string | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
    code = body?.error?.code;
    message = body?.error?.message ?? (typeof body?.detail === "string" ? body.detail : message);
  } catch {
    // non-JSON error body; keep default message
  }
  return new ApiError(response.status, message, code, body);
}

async function request<T>(method: string, path: string, payload?: unknown, options: RequestOptions = {}): Promise<T> {
  const { query, signal, timeoutMs = 15000 } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: payload !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new ApiNetworkError(
      "Could not reach the governance backend. Confirm it is running and that CORS allows this origin.",
      cause
    );
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, payload?: unknown, options?: RequestOptions) => request<T>("POST", path, payload, options),
  put: <T>(path: string, payload?: unknown, options?: RequestOptions) => request<T>("PUT", path, payload, options),
  patch: <T>(path: string, payload?: unknown, options?: RequestOptions) => request<T>("PATCH", path, payload, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

// Lightweight health probe — used by UI to decide mock vs live without throwing.
export async function isBackendReachable(): Promise<boolean> {
  try {
    await apiClient.get("/health", { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}
