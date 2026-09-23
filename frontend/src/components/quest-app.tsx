"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionView } from "../../../contracts/backend";
import { apiRequest, ApiFailure, endpoints } from "@/lib/api";
import { Login } from "./quest/login";
import { Navigation } from "./quest/navigation";
import { Employee } from "./quest/employee";
import { Hr } from "./quest/hr";
import { Failure, Loading } from "./quest/feedback";
export default function QuestApp({
  initialView = "overview",
}: {
  initialView?: "overview" | "hr";
}) {
  const [session, setSession] = useState<SessionView | null>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onError = useCallback((error: unknown) => {
    if (error instanceof ApiFailure && error.status === 401) {
      setSession(null);
      setError(error);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setSession(undefined);
    apiRequest<SessionView>(endpoints.session, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSession(result.data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error);
          if (error instanceof ApiFailure && error.status === 401)
            setSession(null);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  if (session === undefined)
    return (
      <main className="login-page">
        <section className="panel">
          <h1>Career Quest</h1>
          {error ? (
            <>
              <Failure error={error} retry={() => setAttempt((n) => n + 1)} />
              <p>
                Для рабочего режима нужны серверные API-обработчики в этом
                приложении.
              </p>
              <a href="/demo">Открыть отдельный UI-демо</a>
            </>
          ) : (
            <Loading>Проверка сессии…</Loading>
          )}
        </section>
      </main>
    );
  if (!session)
    return (
      <>
        <Failure error={error} />
        <Login
          onLogin={(value) => {
            setError(undefined);
            setSession(value);
          }}
        />
      </>
    );
  return (
    <>
      <Navigation
        session={session}
        busy={busy}
        logout={async () => {
          if (busy) return;
          setBusy(true);
          setError(undefined);
          try {
            await apiRequest(endpoints.logout, { method: "POST" });
            setSession(null);
          } catch (error) {
            setError(error);
            onError(error);
          } finally {
            setBusy(false);
          }
        }}
      />
      <main>
        <Failure error={error} />
        {initialView === "hr" && session.role !== "hr" ? (
          <Failure error={new Error("Нет доступа к HR-данным.")} />
        ) : session.role === "hr" ? (
          <Hr onError={onError} />
        ) : session.employee_id ? (
          <Employee
            key={`${session.account_id}-${session.employee_id}`}
            id={session.employee_id}
            onError={onError}
          />
        ) : (
          <Failure
            error={
              new Error("К учётной записи не привязан профиль сотрудника.")
            }
          />
        )}
      </main>
    </>
  );
}
