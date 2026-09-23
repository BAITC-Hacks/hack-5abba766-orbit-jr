import type { ApiError, ApiResponse } from "../../../contracts/backend";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiResponse<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
  });
  const payload: ApiResponse<T> | ApiError | null = await response
    .json()
    .catch(() => null);
  if (!response.ok) {
    const error = payload && "error" in payload ? payload : null;
    throw new ApiClientError(
      error?.error.message ??
        `Сервер не смог выполнить запрос (${response.status}).`,
      response.status,
      error?.error.code ?? "HTTP_ERROR",
      error?.error.details,
      error?.request_id,
    );
  }
  if (!payload || !("data" in payload) || !("meta" in payload)) {
    throw new ApiClientError(
      "Сервер вернул ответ в неизвестном формате.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
  return payload;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await apiResponse<T>(path, options)).data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError")
    return "Сервер не ответил вовремя. Повторите запрос.";
  if (error instanceof ApiClientError)
    return `${error.message} (${error.code})`;
  if (error instanceof TypeError)
    return "Нет связи с сервером. Проверьте, что приложение запущено, и повторите запрос.";
  return error instanceof Error
    ? error.message
    : "Не удалось выполнить действие.";
}

export const endpoints = {
  login: "/api/auth/login",
  session: "/api/auth/session",
  logout: "/api/auth/logout",
  catalog: "/api/catalog",
  directory: "/api/employees",
  employee: (id: string) => `/api/employees/${encodeURIComponent(id)}`,
  goal: (id: string) => `/api/employees/${encodeURIComponent(id)}/goal`,
  recommendations: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/recommendations`,
  completions: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/completions`,
  hr: "/api/hr/overview",
  import: "/api/import",
};
