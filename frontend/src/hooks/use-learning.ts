"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletionRequest, DomainVersion, EmployeeView } from "../../../contracts/backend";
import type { LearningAttempt, LearningModuleView, SubmitQuizRequest, SubmitQuizResult } from "../../../contracts/learning";
import { apiRequest, ApiFailure, endpoints } from "@/lib/api";

export function useLearning(employeeId: string, moduleId: string, target: CompletionRequest["target"], initialVersion: DomainVersion, onError: (error: unknown) => void) {
  const [module, setModule] = useState<LearningModuleView>();
  const [attempt, setAttempt] = useState<LearningAttempt>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitQuizResult>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const lock = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const version = useRef(initialVersion);
  const receipt = useRef<{ key: string; body: SubmitQuizRequest } | null>(null);
  const targetKey = JSON.stringify(target);

  const fail = useCallback((value: unknown) => {
    setError(value);
    setNeedsRefresh(value instanceof ApiFailure && value.code === "REVISION_CONFLICT");
    onError(value);
  }, [onError]);

  const initialize = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    lifecycle.current?.abort();
    const controller = new AbortController();
    lifecycle.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const content = await apiRequest<LearningModuleView>(endpoints.learningModule(moduleId), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setModule(content.data);
      const progress = await apiRequest<LearningAttempt>(endpoints.learningAttempts(employeeId), {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ module_id: moduleId, target: JSON.parse(targetKey), expected_version: version.current }),
      });
      if (controller.signal.aborted) return;
      setAttempt(progress.data);
      setModule(progress.data.module);
      version.current = progress.data.employee_version;
      setNeedsRefresh(false);
    } catch (value) {
      if (!controller.signal.aborted) fail(value);
    } finally {
      if (lifecycle.current === controller) lock.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [employeeId, moduleId, targetKey, fail]);

  useEffect(() => {
    void initialize();
    return () => { lifecycle.current?.abort(); lock.current = false; };
  }, [initialize]);

  async function completeLesson(lessonId: string): Promise<boolean> {
    if (!attempt || lock.current || receipt.current) return false;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const signal = lifecycle.current!.signal;
    try {
      const response = await apiRequest<LearningAttempt>(endpoints.learningLessons(employeeId, attempt.id), {
        method: "POST", signal, body: JSON.stringify({ lesson_id: lessonId }),
      });
      if (signal.aborted) return false;
      setAttempt(response.data);
      version.current = response.data.employee_version;
      return true;
    } catch (value) {
      if (!signal.aborted) fail(value);
      return false;
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function submitQuiz(): Promise<void> {
    if (!attempt || lock.current || attempt.status === "passed") return;
    if (!receipt.current) receipt.current = { key: crypto.randomUUID(), body: { answers: { ...answers }, expected_version: { ...version.current } } };
    const saved = receipt.current;
    lock.current = true;
    setBusy(true);
    setPending(true);
    setError(undefined);
    const signal = lifecycle.current!.signal;
    try {
      const response = await apiRequest<SubmitQuizResult>(endpoints.learningQuiz(employeeId, attempt.id), {
        method: "POST", signal, headers: { "Idempotency-Key": saved.key }, body: JSON.stringify(saved.body),
      });
      if (signal.aborted) return;
      setResult(response.data);
      setAttempt(response.data.attempt);
      version.current = response.data.attempt.employee_version;
      receipt.current = null;
      setPending(false);
    } catch (value) {
      if (!signal.aborted) {
        if (value instanceof ApiFailure && value.status >= 400 && value.status < 500) {
          receipt.current = null;
          setPending(false);
        }
        fail(value);
      }
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function refreshVersion(): Promise<void> {
    if (lock.current || receipt.current) return;
    lock.current = true;
    setBusy(true);
    const signal = lifecycle.current!.signal;
    let retryStart = false;
    try {
      const response = await apiRequest<EmployeeView>(endpoints.employee(employeeId), { signal });
      if (signal.aborted) return;
      version.current = response.data.version;
      setAttempt(current => current ? { ...current, employee_version: response.data.version } : current);
      setError(undefined);
      setNeedsRefresh(false);
      retryStart = !attempt;
    } catch (value) { if (!signal.aborted) fail(value); }
    finally { lock.current = false; if (!signal.aborted) setBusy(false); }
    if (retryStart && !signal.aborted) await initialize();
  }

  return {
    module, attempt, answers, result, loading, busy, error, pending, needsRefresh,
    initialize, completeLesson, submitQuiz, refreshVersion,
    answer: (questionId: string, optionId: string) => {
      if (lock.current || receipt.current || attempt?.status === "passed") return;
      setAnswers(current => ({ ...current, [questionId]: optionId }));
      setResult(undefined);
      setError(undefined);
    },
  };
}
