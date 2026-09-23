"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompletionRequest,
  CompletionResult,
  EmployeeView,
  GoalRequest,
  GoalResult,
  GoalProgress,
  RecommendationResult,
} from "../../../contracts/backend";
import {
  apiRequest,
  ApiFailure,
  endpoints,
  sameVersion,
  isDefinitiveRejection,
} from "@/lib/api";

export function useEmployee(
  id: string,
  onError: (error: unknown) => void,
  onChanged?: () => void,
) {
  const [profile, setProfile] = useState<EmployeeView>();
  const [recommendations, setRecommendations] =
    useState<RecommendationResult>();
  const [error, setError] = useState<unknown>();
  const [recError, setRecError] = useState<unknown>();
  const [mutationError, setMutationError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [recLoading, setRecLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>();
  const [completion, setCompletion] = useState<{ result: CompletionResult; previousProgress: GoalProgress | null }>();
  const generation = useRef(0);
  const profileAbort = useRef<AbortController | null>(null);
  const recAbort = useRef<AbortController | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);
  const lock = useRef(false);
  // Keep the exact body and key after an ambiguous network failure. Never retry
  // the same key with a new expected_version. Component is keyed by employee ID.
  const receipt = useRef<{
    action: string;
    key: string;
    body: CompletionRequest;
    previousProgress: GoalProgress | null;
  } | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const recommend = useCallback(
    async (employee: EmployeeView) => {
      recAbort.current?.abort();
      const controller = new AbortController();
      recAbort.current = controller;
      const epoch = generation.current;
      setRecLoading(true);
      setRecError(undefined);
      setRecommendations(undefined);
      try {
        const result = await apiRequest<RecommendationResult>(
          endpoints.recommendations(id),
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              expected_version: employee.version,
              limit: 3,
            }),
          },
        );
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (!sameVersion(employee.version, result.data.version))
          throw new ApiFailure(
            409,
            "STALE_RECOMMENDATION",
            "Состояние изменилось. Обновите профиль для новой подборки.",
          );
        setRecommendations(result.data);
      } catch (error) {
        if (!controller.signal.aborted && epoch === generation.current) {
          setRecError(error);
          onError(error);
        }
      } finally {
        if (!controller.signal.aborted && epoch === generation.current)
          setRecLoading(false);
      }
    },
    [id, onError],
  );
  const refresh = useCallback(async () => {
    const epoch = ++generation.current;
    profileAbort.current?.abort();
    recAbort.current?.abort();
    const controller = new AbortController();
    profileAbort.current = controller;
    setLoading(true);
    setProfile(undefined);
    setRecommendations(undefined);
    setError(undefined);
    setRecError(undefined);
    setRecLoading(false);
    try {
      const result = await apiRequest<EmployeeView>(endpoints.employee(id), {
        signal: controller.signal,
      });
      if (controller.signal.aborted || epoch !== generation.current) return;
      if (result.data.employee_id !== id)
        throw new Error("Сервер вернул другой профиль.");
      setProfile(result.data);
      setAsOfDate(result.meta.as_of_date ?? undefined);
      void recommend(result.data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error);
        onError(error);
      }
    } finally {
      if (!controller.signal.aborted && epoch === generation.current)
        setLoading(false);
    }
  }, [id, onError, recommend]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
      profileAbort.current?.abort();
      recAbort.current?.abort();
      mutationAbort.current?.abort();
    };
  }, [refresh]);
  async function complete(target: CompletionRequest["target"]) {
    if (!profile || lock.current) return;
    const action = JSON.stringify(target);
    if (receipt.current && receipt.current.action !== action) return;
    if (!receipt.current)
      receipt.current = {
        action,
        key: crypto.randomUUID(),
        body: { expected_version: profile.version, simulation: true, target },
        previousProgress: profile.progress ?? null,
      };
    const saved = receipt.current;
    lock.current = true;
    setBusy(true);
    setPendingTarget(action);
    setMutationError(undefined);
    setNotice("");
    ++generation.current;
    recAbort.current?.abort();
    setRecommendations(undefined);
    setRecLoading(false);
    const controller = new AbortController();
    mutationAbort.current = controller;
    try {
      const result = await apiRequest<CompletionResult>(
        endpoints.completions(id),
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Idempotency-Key": saved.key },
          body: JSON.stringify(saved.body),
        },
      );
      if (controller.signal.aborted) return;
      receipt.current = null;
      setPendingTarget(null);
      onChanged?.();
      setNotice(
        result.meta.replayed ? "Сохранённый результат восстановлен. Навыки повторно не начислены." : "Выполнение отмечено. Посмотрите, как изменился ваш путь.",
      );
      setCompletion({ result: result.data, previousProgress: saved.previousProgress });
      // Receipt may be older than current state: always GET current profile.
      await refresh();
    } catch (error) {
      if (!controller.signal.aborted) {
        setMutationError(error);
        onError(error);
        if (isDefinitiveRejection(error)) {
          receipt.current = null;
          setPendingTarget(null);
          await refresh();
        }
      }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function changeGoal(goal: GoalRequest["career_goal"]) {
    if (!profile || lock.current || receipt.current) return;
    lock.current = true;
    setBusy(true);
    setMutationError(undefined);
    setNotice("");
    ++generation.current;
    recAbort.current?.abort();
    setRecommendations(undefined);
    setRecLoading(false);
    const controller = new AbortController();
    mutationAbort.current = controller;
    try {
      await apiRequest<GoalResult>(endpoints.goal(id), {
        method: "PUT",
        signal: controller.signal,
        body: JSON.stringify({
          expected_version: profile.version,
          career_goal: goal,
        }),
      });
      if (!controller.signal.aborted) {
        setNotice("Цель сохранена.");
        setCompletion(undefined);
        onChanged?.();
        await refresh();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setMutationError(error);
        onError(error);
        await refresh();
      }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    profile,
    asOfDate,
    recommendations,
    error,
    recError,
    mutationError,
    loading,
    recLoading,
    busy,
    notice,
    completion,
    dismissCompletion: () => setCompletion(undefined),
    acceptLearningCompletion: async (result: CompletionResult, previousProgress: GoalProgress | null) => {
      setCompletion({ result, previousProgress });
      setNotice("Демомодуль пройден. Результат сохранён, следующие шаги обновляются.");
      onChanged?.();
      await refresh();
    },
    pendingTarget,
    refresh,
    complete,
    changeGoal,
    retryCompletion: () =>
      receipt.current && complete(receipt.current.body.target),
    retryRecommendations: () => {
      if (profile && !busy && !pendingTarget) void refresh();
    },
  };
}
