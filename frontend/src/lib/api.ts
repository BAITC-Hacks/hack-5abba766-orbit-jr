// Optional integration transport. UI currently uses explicit authored demo fixtures.
// Map backend Zod contracts to UI view models here once teammates finalize schemas.
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Не удалось выполнить запрос (${response.status})`);
  return response.json() as Promise<T>;
}
export const endpoints = {
  employee: (id: string) => `/api/employees/${encodeURIComponent(id)}`,
  recommendations: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/recommendations`,
  completions: (id: string) =>
    `/api/employees/${encodeURIComponent(id)}/completions`,
  hr: "/api/hr/overview",
  import: "/api/import",
};
