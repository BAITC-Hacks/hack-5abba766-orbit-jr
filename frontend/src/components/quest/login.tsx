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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
              value={username}
              onChange={(event) => setUsername(event.target.value)}
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>
        <Failure error={error} />
        <details className="demo-credentials" open>
          <summary>Аккаунты локальной демонстрации</summary>
          <p>
            Сотрудник: <code>employee / employee-demo-2026</code>
          </p>
          <p>
            HR: <code>hr / hr-demo-2026</code>
          </p>
          <p className="fine-print">
            Это значения по умолчанию для первого запуска. Если при
            инициализации пароли изменили в .env, используйте заданные значения.
          </p>
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setUsername("employee");
                setPassword("employee-demo-2026");
              }}
            >
              Заполнить: сотрудник
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setUsername("hr");
                setPassword("hr-demo-2026");
              }}
            >
              Заполнить: HR
            </button>
          </div>
        </details>
        <p className="fine-print">
          <a href="/demo">Открыть отдельный UI-демо</a>
        </p>
      </section>
    </main>
  );
}
