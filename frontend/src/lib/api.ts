import type { ApiResponse, DomainVersion } from "../../../contracts/backend";
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public requestId?: string,
  ) {
    super(message);
  }
}
// Use team runtime schemas here once supplied; these shared types are declarations only.
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiFailure(
      0,
      "NETWORK_ERROR",
      "Сервер недоступен или не ответил вовремя. Повторите запрос.",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  if (!response.ok) {
    const error = body?.error as
      | { code?: string; message?: string; details?: Record<string, unknown> }
      | undefined;
    throw new ApiFailure(
      response.status,
      error?.code ?? "HTTP_ERROR",
      response.status === 401
        ? path === endpoints.login
          ? (error?.message ?? "Неверный логин или пароль. Проверьте данные и попробуйте снова.")
          : "Сессия истекла. Войдите снова."
        : response.status === 403
          ? "Нет доступа к этому разделу."
          : (error?.message ??
            `API недоступен (${response.status}). Проверьте запуск серверных обработчиков.`),
      error?.details,
      typeof body?.request_id === "string" ? body.request_id : undefined,
    );
  }
  if (
    !body ||
    body.data == null ||
    !body.meta ||
    typeof body.meta !== "object" ||
    Array.isArray(body.meta)
  )
    throw new ApiFailure(
      response.status,
      "INVALID_RESPONSE",
      "Сервер вернул ответ вне согласованного контракта.",
    );
  return body as ApiResponse<T>;
}
export function sameVersion(a: DomainVersion, b: DomainVersion) {
  return (
    a.dataset_revision === b.dataset_revision &&
    a.employee_revision === b.employee_revision
  );
}
export const endpoints = {
  login: "/api/auth/login",
  session: "/api/auth/session",
  logout: "/api/auth/logout",
  employees: "/api/employees",
  catalog: "/api/catalog",
  goal: (id: string) => `/api/employees/${encodeURIComponent(id)}/goal`,
  employee: (id: string) => `/api/employees/${encodeURIComponent(id)}`,
  recommendations: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/recommendations`,
  completions: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/completions`,
  hr: "/api/hr/overview",
  import: "/api/import",
};
// Timeouts and throttling do not establish whether a write committed.
export function isDefinitiveRejection(error: unknown): error is ApiFailure {
  return (
    error instanceof ApiFailure &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}
