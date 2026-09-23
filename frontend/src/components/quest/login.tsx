"use client";
import { useState } from "react";
import type { SessionView } from "../../../../contracts/backend";
import { apiRequest, endpoints } from "@/lib/api";
import { Failure } from "./feedback";
export function Login({
  onLogin,
}: {
  onLogin: (session: SessionView) => void;
}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <section className="panel">
        <span className="eyebrow">CAREER QUEST</span>
        <h1>Ваш следующий шаг.</h1>
        <p>Войдите с учётной записью, подготовленной командой.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError(undefined);
            try {
              onLogin(
                (
                  await apiRequest<SessionView>(endpoints.login, {
                    method: "POST",
                    body: JSON.stringify({
                      username: form.get("username"),
                      password: form.get("password"),
                    }),
                  })
                ).data,
              );
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label">
            Логин
            <input
              name="username"
              autoComplete="username"
              required
              disabled={busy}
            />
          </label>
          <label className="field-label">
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>
        <Failure error={error} />
        <p className="fine-print">
          <a href="/demo">Открыть отдельный UI-демо</a>
        </p>
      </section>
    </main>
  );
}
