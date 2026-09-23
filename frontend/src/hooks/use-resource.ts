"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
export function useResource<T>(
  path: string,
  onError: (error: unknown) => void,
) {
  const [state, setState] = useState<{
    path: string;
    data?: T;
    error?: unknown;
    loading: boolean;
  }>({ path, loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      path,
      data: previous.path === path ? previous.data : undefined,
      loading: true,
    }));
    apiRequest<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          setState({ path, data: result.data, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ path, error, loading: false });
          onError(error);
        }
      });
    return () => controller.abort();
  }, [path, revision, onError]);
  return {
    ...(state.path === path
      ? state
      : { loading: true, data: undefined, error: undefined }),
    reload,
  };
}
