"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SessionView } from "../../../contracts/backend";
import { apiRequest, ApiFailure, endpoints } from "@/lib/api";
import { Login } from "./quest/login";
import { Navigation } from "./quest/navigation";
import { Employee } from "./quest/employee";
import { Hr } from "./quest/hr";
import { Failure, Loading } from "./quest/feedback";
import { Brand } from "./quest/visuals";
export default function QuestApp({
  initialView = "overview",
}: {
  initialView?: "overview" | "hr";
}) {
  const [session, setSession] = useState<SessionView | null>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sessionRequest = useRef<AbortController | null>(null);
  const onError = useCallback((error: unknown) => {
    if (error instanceof ApiFailure && error.status === 401) {
      sessionRequest.current?.abort();
      setSession(null);
      setError(error);
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const checkSession = () => {
      sessionRequest.current?.abort();
      const controller = new AbortController();
      sessionRequest.current = controller;
      setError(undefined);
      setSession(undefined);
      setBusy(false);
      apiRequest<SessionView>(endpoints.session, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setSession(result.data);
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            if (error instanceof ApiFailure && error.status === 401) {
              setSession(null);
            } else setError(error);
          }
        });
    };
    checkSession();
    if (typeof window === "undefined")
      return () => sessionRequest.current?.abort();

    // Back/Forward can restore the entire React tree without mounting it again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) checkSession();
    };
    const onPageHide = () => {
      sessionRequest.current?.abort();
      // Remove account data before the browser freezes this document in bfcache.
      flushSync(() => {
        setSession(undefined);
        setError(undefined);
        setBusy(false);
      });
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", checkSession);
    return () => {
      sessionRequest.current?.abort();
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", checkSession);
    };
  }, [attempt]);
  if (session === undefined)
    return (
      <main className="login-page">
        <section className="panel">
          <Brand />
          {error ? (
            <>
              <Failure error={error} retry={() => setAttempt((n) => n + 1)} />
              <p>
                Не удалось подключиться к сервису. Повторите попытку через
                несколько секунд.
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
        <Login
          notice={error}
          onLogin={(value) => {
            sessionRequest.current?.abort();
            setError(undefined);
            setSession(value);
          }}
        />
      </>
    );
  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <Navigation
        session={session}
        busy={busy}
        logout={async () => {
          if (busy) return;
          sessionRequest.current?.abort();
          const controller = new AbortController();
          sessionRequest.current = controller;
          setBusy(true);
          setError(undefined);
          try {
            await apiRequest(endpoints.logout, {
              method: "POST",
              signal: controller.signal,
            });
            if (!controller.signal.aborted) setSession(null);
          } catch (error) {
            if (!controller.signal.aborted) {
              setError(error);
              onError(error);
            }
          } finally {
            if (!controller.signal.aborted) setBusy(false);
          }
        }}
      />
      <main id="main-content" tabIndex={-1} className="connected-main">
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
        <footer className="app-footer">
          <Brand />
          <span>Развитие сотрудников</span>
          <span>Career Quest</span>
        </footer>
      </main>
    </>
  );
}
