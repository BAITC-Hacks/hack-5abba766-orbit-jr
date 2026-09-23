"use client";
import { useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { SessionView } from "../../../../contracts/backend";
import { apiRequest, endpoints } from "@/lib/api";
import { Failure } from "./feedback";
import { Brand } from "./visuals";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [demoRole, setDemoRole] = useState<"employee" | "hr" | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error && !busy) passwordInput.current?.focus();
  }, [error, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  function chooseDemo(role: "employee" | "hr") {
    setDemoRole(role);
    setUsername(role);
    setPassword(role === "hr" ? "hr-demo-2026" : "employee-demo-2026");
    setError(undefined);
  }
  return (
    <main className="login-experience">
      <section className="login-form-side">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <span className="login-context">
          <ShieldCheck size={16} /> Пространство вашей карьеры
        </span>
        <div className="login-form-content">
          <span className="eyebrow">НАЧНИТЕ СЛЕДУЮЩУЮ ГЛАВУ</span>
          <h1>
            Вход в Career Quest
          </h1>
          <p className="login-intro">
            Обучение, навыки и развитие карьеры.
          </p>
          <div className="login-role-label">Попробуйте демо-аккаунт</div>
          <div className="login-roles" aria-label="Выбор демо-аккаунта">
            <button
              type="button"
              className={demoRole === "employee" ? "active" : ""}
              aria-pressed={demoRole === "employee"}
              disabled={busy}
              onClick={() => chooseDemo("employee")}
            >
              <UserRound size={22} />
              <span>
                <strong>Сотрудник</strong>
                <small>Мой путь развития</small>
              </span>
              <i />
            </button>
            <button
              type="button"
              className={demoRole === "hr" ? "active" : ""}
              aria-pressed={demoRole === "hr"}
              disabled={busy}
              onClick={() => chooseDemo("hr")}
            >
              <Users size={22} />
              <span>
                <strong>HR-команда</strong>
                <small>Потенциал команды</small>
              </span>
              <i />
            </button>
          </div>
          <Failure error={notice} />
          <form
            aria-busy={busy}
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current) return;
              lock.current = true;
              const request = new AbortController();
              controller.current = request;
              setBusy(true);
              setError(undefined);
              try {
                const response = await apiRequest<SessionView>(
                  endpoints.login,
                  {
                    method: "POST",
                    signal: request.signal,
                    body: JSON.stringify({ username, password }),
                  },
                );
                if (!request.signal.aborted) onLogin(response.data);
              } catch (error) {
                if (!request.signal.aborted) setError(error);
              } finally {
                lock.current = false;
                if (!request.signal.aborted) setBusy(false);
              }
            }}
          >
            <label className="field-label" htmlFor="login-username">
              Логин
            </label>
            <div className="login-input-wrap">
              <UserRound size={19} aria-hidden="true" />
              <input
                id="login-username"
                name="username"
                placeholder="Введите ваш логин"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setDemoRole(null);
                }}
              />
            </div>
            <label className="field-label" htmlFor="login-password">
              Пароль
            </label>
            <div className="login-input-wrap password-field">
              <ShieldCheck size={19} aria-hidden="true" />
              <input
                id="login-password"
                ref={passwordInput}
                name="password"
                type={visible ? "text" : "password"}
                placeholder="Введите пароль"
                autoComplete="current-password"
                aria-describedby={error ? "login-error" : undefined}
                required
                disabled={busy}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setDemoRole(null);
                }}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={visible}
                disabled={busy}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <div id="login-error"><Failure error={error} /></div>
            <button className="primary login-submit" disabled={busy}>
              {busy ? (
                <>
                  <span className="button-spinner" />
                  Входим в пространство…
                </>
              ) : (
                <>
                  Войти в Career Quest <ArrowRight size={19} />
                </>
              )}
            </button>
          </form>
          <details className="login-help">
            <summary>Как войти в демонстрацию?</summary>
            <p>
              Выберите карточку сотрудника или HR — логин и пароль заполнятся.
              Затем нажмите «Войти». Если пароль аккаунта изменён, используйте
              свой.
            </p>
            <p>
              <code>employee / employee-demo-2026</code>
              <br />
              <code>hr / hr-demo-2026</code>
            </p>
          </details>
          <div className="login-reassurance">
            <ShieldCheck size={17} />
            <p>
              Ваши цели. Ваш темп.
              <br />
              <strong>Ваш следующий шаг — здесь.</strong>
            </p>
          </div>
        </div>
        <div className="login-legal">
          <span>Halyk · Career Quest</span>
          <a href="/demo">
            Визуальное демо <ArrowUpRight size={13} />
          </a>
        </div>
      </section>
    </main>
  );
}
