"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { SessionView } from "../../../../contracts/backend";
import { apiRequest, endpoints } from "@/lib/api";
import { Failure } from "./feedback";
export function Login({
  onLogin,
  notice,
}: {
  onLogin: (session: SessionView) => void;
  notice?: unknown;
}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error && !busy) passwordInput.current?.focus();
  }, [error, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <main className="login-page">
      <section className="panel">
        <span className="eyebrow">CAREER QUEST</span>
        <h1>Ваш следующий шаг.</h1>
        <p>Войдите с учётной записью, подготовленной командой.</p>
        <Failure error={notice} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            const form = new FormData(e.currentTarget);
            lock.current = true;
            const request = new AbortController();
            controller.current = request;
            setBusy(true);
            setError(undefined);
            try {
              const result = await apiRequest<SessionView>(endpoints.login, {
                method: "POST",
                signal: request.signal,
                body: JSON.stringify({
                  username: form.get("username"),
                  password: form.get("password"),
                }),
              });
              if (!request.signal.aborted) onLogin(result.data);
            } catch (error) {
              if (!request.signal.aborted) setError(error);
            } finally {
              lock.current = false;
              if (!request.signal.aborted) setBusy(false);
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
          <div className="password-field">
            <label className="field-label" htmlFor="login-password">
              Пароль
            </label>
            <input
              id="login-password"
              ref={passwordInput}
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
              disabled={busy}
            >
              {visible ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
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
