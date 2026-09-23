"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  CareerGoal,
  CatalogView,
  CompletionRequest,
  CompletionResult,
  DomainVersion,
  EmployeeDirectory,
  EmployeeView,
  GoalResult,
  HrOverview,
  RecommendationResult,
  SessionView,
} from "../../../contracts/backend";
import {
  ApiClientError,
  apiRequest,
  apiResponse,
  endpoints,
  errorMessage,
} from "@/lib/api";
import {
  ActivityCatalog,
  ActivityDetails,
  EmployeeOverview,
  HrDashboard,
  ParticipationHistory,
  dateLabel,
  type ActivitySelection,
} from "./career-panels";
import ImportPanel from "./import-panel";

type View = "overview" | "catalog" | "history" | "hr";
const sameVersion = (a: DomainVersion, b: DomainVersion) =>
  a.dataset_revision === b.dataset_revision &&
  a.employee_revision === b.employee_revision;

export default function QuestApp({
  initialView = "overview",
}: {
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [session, setSession] = useState<SessionView | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [username, setUsername] = useState(
    initialView === "hr" ? "hr" : "employee",
  );
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [directory, setDirectory] = useState<EmployeeDirectory | null>(null);
  const [directorySearch, setDirectorySearch] = useState("");
  const [directoryOffset, setDirectoryOffset] = useState(0);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const selectedId = useRef("");
  const [employee, setEmployee] = useState<EmployeeView | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState("");
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [recommendations, setRecommendations] =
    useState<RecommendationResult | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const [hr, setHr] = useState<HrOverview | null>(null);
  const [hrLoading, setHrLoading] = useState(false);
  const [hrError, setHrError] = useState("");
  const [dataRefresh, setDataRefresh] = useState(0);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [recommendationsRefresh, setRecommendationsRefresh] = useState(0);
  const [hrRefresh, setHrRefresh] = useState(0);
  const [selection, setSelection] = useState<ActivitySelection | null>(null);
  const [dialog, setDialog] = useState<"goal" | "import" | null>(null);
  const [draftGoal, setDraftGoal] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationLock = useRef(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const modalRef = useRef<HTMLDialogElement>(null);
  const recommendationEpoch = useRef(0);
  const recommendationAbort = useRef<AbortController | null>(null);
  const employeeEpoch = useRef(0);
  const pendingCompletions = useRef(
    new Map<string, { key: string; request: CompletionRequest }>(),
  );

  function onError(cause: unknown) {
    if (cause instanceof ApiClientError && cause.status === 401) {
      setSession(null);
      setEmployee(null);
      setCatalog(null);
      selectedId.current = "";
      setEmployeeId("");
      setError("Сессия закончилась. Войдите снова.");
    } else setError(errorMessage(cause));
  }
  function invalidateRecommendations() {
    recommendationEpoch.current += 1;
    recommendationAbort.current?.abort();
    setRecommendations(null);
    setRecommendationsLoading(false);
    setRecommendationsError("");
  }
  function closeDialog() {
    if (!mutationLock.current) {
      setSelection(null);
      setDialog(null);
      setError("");
    }
  }
  function chooseEmployee(id: string, navigate = false) {
    if (mutationLock.current) return;
    if (id === selectedId.current) {
      setProfileRefresh((value) => value + 1);
      if (navigate) setView("overview");
      return;
    }
    employeeEpoch.current += 1;
    selectedId.current = id;
    setEmployeeId(id);
    setEmployee(null);
    setEmployeeError("");
    invalidateRecommendations();
    setSelection(null);
    setDialog(null);
    setError("");
    if (navigate) setView("overview");
  }
  function openActivity(value: ActivitySelection) {
    if (!employee || mutationLock.current) return;
    if (
      value.candidate &&
      (!recommendations ||
        !sameVersion(recommendations.version, employee.version))
    ) {
      setError("Подбор устарел. Обновите рекомендации.");
      return;
    }
    setError("");
    setSelection(value);
  }

  useEffect(() => {
    const controller = new AbortController();
    setSessionLoading(true);
    setError("");
    apiRequest<SessionView>(endpoints.session, { signal: controller.signal })
      .then((current) => {
        if (controller.signal.aborted) return;
        setSession(current);
        if (current.role === "employee") {
          selectedId.current = current.employee_id ?? "";
          setEmployeeId(current.employee_id ?? "");
          setView((value) => (value === "hr" ? "overview" : value));
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setSession(null);
        if (!(cause instanceof ApiClientError && cause.status === 401))
          setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionLoading(false);
      });
    return () => controller.abort();
  }, [sessionRefresh]);

  useEffect(() => {
    if (!session) {
      setCatalog(null);
      return;
    }
    const controller = new AbortController();
    setCatalogError("");
    apiResponse<CatalogView>(endpoints.catalog, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setCatalog(response.data);
          setAsOfDate(response.meta.as_of_date);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(errorMessage(cause));
          if (cause instanceof ApiClientError && cause.status === 401)
            setSession(null);
        }
      });
    return () => controller.abort();
  }, [session, dataRefresh]);

  useEffect(() => {
    if (!session || session.role !== "hr") {
      setDirectory(null);
      return;
    }
    const controller = new AbortController();
    setDirectoryLoading(true);
    setDirectoryError("");
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          limit: "50",
          offset: String(directoryOffset),
          q: directorySearch,
        });
        apiRequest<EmployeeDirectory>(`${endpoints.directory}?${params}`, {
          signal: controller.signal,
        })
          .then((response) => {
            if (controller.signal.aborted) return;
            setDirectory(response);
            if (!selectedId.current && response.items.length) {
              selectedId.current = response.items[0].employee_id;
              setEmployeeId(response.items[0].employee_id);
            }
          })
          .catch((cause: unknown) => {
            if (!controller.signal.aborted) {
              setDirectoryError(errorMessage(cause));
              if (cause instanceof ApiClientError && cause.status === 401)
                setSession(null);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setDirectoryLoading(false);
          });
      },
      directorySearch ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [session, directorySearch, directoryOffset, dataRefresh]);

  useEffect(() => {
    if (!session || !employeeId) {
      setEmployee(null);
      return;
    }
    const controller = new AbortController();
    const epoch = ++employeeEpoch.current;
    selectedId.current = employeeId;
    setEmployeeLoading(true);
    setEmployeeError("");
    setEmployee(null);
    setSelection(null);
    invalidateRecommendations();
    apiResponse<EmployeeView>(endpoints.employee(employeeId), {
      signal: controller.signal,
    })
      .then((response) => {
        if (
          !controller.signal.aborted &&
          epoch === employeeEpoch.current &&
          selectedId.current === employeeId
        ) {
          setEmployee(response.data);
          setAsOfDate(response.meta.as_of_date);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && epoch === employeeEpoch.current) {
          setEmployeeError(errorMessage(cause));
          if (cause instanceof ApiClientError && cause.status === 401)
            setSession(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && epoch === employeeEpoch.current)
          setEmployeeLoading(false);
      });
    return () => controller.abort();
  }, [session, employeeId, profileRefresh, dataRefresh]);

  useEffect(() => {
    if (!session || !employee) return;
    const controller = new AbortController();
    recommendationAbort.current = controller;
    const epoch = ++recommendationEpoch.current;
    const targetId = employee.employee_id;
    const version = employee.version;
    setRecommendationsLoading(true);
    setRecommendationsError("");
    setRecommendations(null);
    apiRequest<RecommendationResult>(endpoints.recommendations(targetId), {
      method: "POST",
      body: JSON.stringify({ expected_version: version, limit: 3 }),
      signal: controller.signal,
    })
      .then((response) => {
        if (
          controller.signal.aborted ||
          epoch !== recommendationEpoch.current ||
          selectedId.current !== targetId
        )
          return;
        if (!sameVersion(response.version, version)) {
          setRecommendationsError(
            "Данные изменились во время подбора. Обновите профиль.",
          );
          return;
        }
        setRecommendations(response);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          epoch !== recommendationEpoch.current ||
          selectedId.current !== targetId
        )
          return;
        if (cause instanceof ApiClientError && cause.status === 401)
          setSession(null);
        else setRecommendationsError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && epoch === recommendationEpoch.current)
          setRecommendationsLoading(false);
      });
    return () => controller.abort();
  }, [session, employee, recommendationsRefresh]);

  useEffect(() => {
    if (!session || session.role !== "hr") {
      setHr(null);
      return;
    }
    const controller = new AbortController();
    setHrLoading(true);
    setHrError("");
    apiRequest<HrOverview>(endpoints.hr, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setHr(response);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setHrError(errorMessage(cause));
          if (cause instanceof ApiClientError && cause.status === 401)
            setSession(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHrLoading(false);
      });
    return () => controller.abort();
  }, [session, hrRefresh, dataRefresh]);
  useEffect(() => {
    if (selection || dialog) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [selection, dialog]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6_000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setError("");
    try {
      const current = await apiRequest<SessionView>(endpoints.login, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setSession(current);
      setPassword("");
      setDirectorySearch("");
      setDirectoryOffset(0);
      if (current.role === "employee") {
        selectedId.current = current.employee_id ?? "";
        setEmployeeId(current.employee_id ?? "");
        setView("overview");
      } else {
        selectedId.current = "";
        setEmployeeId("");
        setView(initialView === "hr" ? "hr" : "overview");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutationBusy(true);
    setError("");
    try {
      await apiRequest(endpoints.logout, {
        method: "POST",
        body: JSON.stringify({}),
      });
      invalidateRecommendations();
      employeeEpoch.current += 1;
      setSession(null);
      setEmployee(null);
      setCatalog(null);
      setHr(null);
      setDirectory(null);
      selectedId.current = "";
      setEmployeeId("");
      setSelection(null);
      setDialog(null);
      pendingCompletions.current.clear();
    } catch (cause) {
      onError(cause);
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }
  async function saveGoal() {
    if (!employee || mutationLock.current) return;
    const id = employee.employee_id;
    const careerGoal: CareerGoal | null = draftGoal
      ? (JSON.parse(draftGoal) as CareerGoal)
      : null;
    mutationLock.current = true;
    setMutationBusy(true);
    setError("");
    invalidateRecommendations();
    try {
      const response = await apiRequest<GoalResult>(endpoints.goal(id), {
        method: "PUT",
        body: JSON.stringify({
          expected_version: employee.version,
          career_goal: careerGoal,
        }),
      });
      if (selectedId.current === id) {
        setEmployee(response.employee);
        setDialog(null);
        setSelection(null);
        setToast(
          response.changed
            ? "Цель сохранена. Пересчитываем следующие шаги."
            : "Эта цель уже выбрана.",
        );
      }
      setHrRefresh((value) => value + 1);
    } catch (cause) {
      onError(cause);
      if (cause instanceof ApiClientError && cause.code === "REVISION_CONFLICT")
        setProfileRefresh((value) => value + 1);
      else setRecommendationsRefresh((value) => value + 1);
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }
  async function completeSelection() {
    if (!employee || !selection || mutationLock.current) return;
    const { candidate, participation } = selection;
    if (!candidate && !participation?.actionable) return;
    const id = employee.employee_id;
    const target: CompletionRequest["target"] = participation
      ? {
          kind: "existing_participation",
          participation_id: participation.participation_id,
        }
      : candidate?.action === "continue" && candidate.participation_id
        ? {
            kind: "existing_participation",
            participation_id: candidate.participation_id,
          }
        : {
            kind: "new_participation",
            event_id: candidate!.event_id,
            session_date: candidate!.session_date,
          };
    const request: CompletionRequest = {
      expected_version: employee.version,
      simulation: true,
      target,
    };
    const fingerprint = JSON.stringify([id, request]);
    let pending = pendingCompletions.current.get(fingerprint);
    if (!pending) {
      pending = { key: crypto.randomUUID(), request };
      pendingCompletions.current.set(fingerprint, pending);
    }
    mutationLock.current = true;
    setMutationBusy(true);
    setError("");
    invalidateRecommendations();
    try {
      const response = await apiRequest<CompletionResult>(
        endpoints.completions(id),
        {
          method: "POST",
          headers: { "Idempotency-Key": pending.key },
          body: JSON.stringify(pending.request),
        },
      );
      pendingCompletions.current.delete(fingerprint);
      if (selectedId.current === id) {
        setSelection(null);
        setToast(
          `Симуляция сохранена. Изменено навыков: ${response.skill_changes.length}.`,
        );
        setProfileRefresh((value) => value + 1);
      }
      setHrRefresh((value) => value + 1);
    } catch (cause) {
      onError(cause);
      if (
        cause instanceof ApiClientError &&
        cause.status >= 400 &&
        cause.status < 500
      ) {
        pendingCompletions.current.delete(fingerprint);
        if (
          [
            "REVISION_CONFLICT",
            "ALREADY_COMPLETED",
            "SESSION_ALREADY_COMPLETED",
            "INVALID_PARTICIPATION_STATE",
          ].includes(cause.code)
        ) {
          setSelection(null);
          setProfileRefresh((value) => value + 1);
        }
      }
      // Keep the exact request and key on uncertain network outcomes so retry cannot double-apply.
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }
  function refreshAll() {
    if (!mutationLock.current) {
      setError("");
      setDataRefresh((value) => value + 1);
    }
  }

  if (sessionLoading)
    return (
      <main className="login-shell">
        <div className="login-card">
          <Compass size={36} />
          <h1>Career Quest</h1>
          <p role="status">Проверяем сессию…</p>
        </div>
      </main>
    );
  if (!session)
    return (
      <main className="login-shell">
        <section className="login-card">
          <span className="brand">
            <span className="brand-icon">
              <Compass size={25} />
            </span>
            career<span>quest</span>
          </span>
          <span className="eyebrow">ВАША КАРЬЕРА. ВАШ МАРШРУТ.</span>
          <h1>Развитие начинается здесь.</h1>
          <p>
            Войдите, чтобы открыть персональную траекторию или обзор команды.
          </p>
          <form onSubmit={(event) => void login(event)}>
            <label className="field-label">
              Логин
              <input
                name="username"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loginBusy}
              />
            </label>
            <label className="field-label">
              Пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loginBusy}
              />
            </label>
            {error && (
              <div role="alert" className="error-panel">
                {error}
              </div>
            )}
            <button className="primary" type="submit" disabled={loginBusy}>
              {loginBusy ? "Входим…" : "Войти"}
              <ArrowRight size={17} />
            </button>
          </form>
          <details className="demo-credentials" open>
            <summary>Аккаунты локальной демонстрации</summary>
            <div>
              <button
                className="secondary"
                disabled={loginBusy}
                onClick={() => {
                  setUsername("employee");
                  setPassword("employee-demo-2026");
                }}
              >
                Сотрудник
              </button>
              <code>employee / employee-demo-2026</code>
            </div>
            <div>
              <button
                className="secondary"
                disabled={loginBusy}
                onClick={() => {
                  setUsername("hr");
                  setPassword("hr-demo-2026");
                }}
              >
                HR
              </button>
              <code>hr / hr-demo-2026</code>
            </div>
          </details>
          {error && (
            <button
              className="text-button spaced"
              disabled={loginBusy}
              onClick={() => setSessionRefresh((value) => value + 1)}
            >
              Проверить подключение
              <RefreshCw size={14} />
            </button>
          )}
        </section>
      </main>
    );

  const selectedPerson = directory?.items.find(
    (person) => person.employee_id === employeeId,
  );
  return (
    <>
      <header className="global-nav">
        <div className="nav-inner">
          <a className="brand" href="/employee">
            <span className="brand-icon">
              <Compass size={21} />
            </span>
            career<span>quest</span>
            <span className="brand-dot" />
          </a>
          <nav aria-label="Главная навигация">
            <button
              disabled={mutationBusy}
              className={
                view === "overview" || view === "history" ? "active" : ""
              }
              onClick={() => setView("overview")}
            >
              {session.role === "hr" ? "Развитие сотрудника" : "Моё развитие"}
            </button>
            <button
              disabled={mutationBusy}
              className={view === "catalog" ? "active" : ""}
              onClick={() => setView("catalog")}
            >
              Каталог
            </button>
            {session.role === "hr" && (
              <button
                disabled={mutationBusy}
                className={view === "hr" ? "active" : ""}
                onClick={() => setView("hr")}
              >
                HR-обзор
              </button>
            )}
          </nav>
          <button
            className="logout-button"
            disabled={mutationBusy}
            onClick={() => void logout()}
            title={`Выйти: ${session.display_name}`}
          >
            <LogOut size={17} />
            <span>Выйти</span>
          </button>
        </div>
      </header>
      <div className="demo-strip">
        <span className="status-dot" />
        Локальный сценарий развития<span className="strip-divider">/</span>
        {session.role === "hr" ? "HR" : "Сотрудник"} · выполнения отмечаются как
        симуляции
      </div>
      <main>
        <div className="page-top">
          <div>
            <div className="eyebrow">
              {view === "hr"
                ? "ЛЮДИ И ВОЗМОЖНОСТИ"
                : "ВАША КАРЬЕРА. ВАШ МАРШРУТ."}
            </div>
            <h1>
              {view === "hr"
                ? "Рост начинается с людей."
                : view === "catalog"
                  ? "Найдите свой следующий шаг."
                  : view === "history"
                    ? "Каждый шаг имеет значение."
                    : "Большое начинается с вас."}
            </h1>
            <p>
              {view === "hr"
                ? "Замечайте потребности. Создавайте возможности для развития."
                : employee
                  ? `${employee.full_name} · ${employee.department} · ${employee.grade} ${employee.role}`
                  : "Загружаем профиль и возможности развития."}
            </p>
          </div>
          {asOfDate && (
            <span className="date-chip">Срез: {dateLabel(asOfDate)}</span>
          )}
        </div>
        {session.role === "hr" && view !== "hr" && (
          <div className="employee-switcher">
            <ShieldCheck size={18} />
            <label>
              Профиль сотрудника
              <select
                aria-label="Выбрать сотрудника"
                value={employeeId}
                disabled={mutationBusy || directoryLoading}
                onChange={(event) => chooseEmployee(event.target.value)}
              >
                {!employeeId && <option value="">Выберите сотрудника</option>}
                {employeeId && !selectedPerson && (
                  <option value={employeeId}>
                    {employee?.full_name ?? employeeId}
                  </option>
                )}
                {directory?.items.map((person) => (
                  <option key={person.employee_id} value={person.employee_id}>
                    {person.full_name} · {person.grade} {person.role}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              disabled={mutationBusy}
              onClick={() => setView("hr")}
            >
              Поиск по всей команде
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {view !== "hr" && (
          <div className="subnav" aria-label="Разделы развития">
            {(
              [
                ["overview", "Обзор"],
                ["catalog", "Возможности"],
                ["history", "Моя активность"],
              ] as const
            ).map(([key, label]) => (
              <button
                disabled={mutationBusy}
                key={key}
                className={view === key ? "selected" : ""}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {error && !selection && !dialog && (
          <div role="alert" className="error-panel">
            {error}
            <button
              className="secondary"
              onClick={refreshAll}
              disabled={mutationBusy}
            >
              Обновить данные
            </button>
          </div>
        )}
        {catalogError && (
          <div role="alert" className="error-panel">
            {catalogError}
            <button className="secondary" onClick={refreshAll}>
              Повторить загрузку
            </button>
          </div>
        )}
        {!catalog && !catalogError && (
          <div className="loading-panel" role="status">
            Загружаем каталог и требования к ролям…
          </div>
        )}
        {catalog && view !== "hr" && (
          <>
            {employeeError && (
              <div role="alert" className="error-panel">
                {employeeError}
                <button
                  className="secondary"
                  onClick={() => setProfileRefresh((value) => value + 1)}
                >
                  Повторить
                </button>
              </div>
            )}
            {directoryError && !employee && (
              <div role="alert" className="error-panel">
                {directoryError}
                <button className="secondary" onClick={refreshAll}>
                  Повторить
                </button>
              </div>
            )}
            {employeeLoading && (
              <div className="loading-panel" role="status">
                Загружаем актуальный профиль…
              </div>
            )}
            {!employee &&
              !employeeLoading &&
              !employeeError &&
              !directoryError && (
                <div className="empty">
                  <Compass />
                  <h3>Выберите сотрудника</h3>
                  <p>
                    {session.role === "hr"
                      ? "Откройте профиль в HR-обзоре, чтобы увидеть его траекторию."
                      : "Для аккаунта пока не назначен профиль сотрудника."}
                  </p>
                </div>
              )}
            {employee && (
              <>
                {view === "overview" && (
                  <EmployeeOverview
                    employee={employee}
                    catalog={catalog}
                    result={recommendations}
                    recommendationsLoading={recommendationsLoading}
                    recommendationsError={recommendationsError}
                    onRetry={() => {
                      if (!mutationLock.current)
                        setProfileRefresh((value) => value + 1);
                    }}
                    onGoal={() => {
                      setDraftGoal(
                        employee.goal.target
                          ? JSON.stringify(employee.goal.target)
                          : "",
                      );
                      setDialog("goal");
                      setError("");
                    }}
                    onSelect={openActivity}
                  />
                )}
                {view === "catalog" && (
                  <ActivityCatalog
                    catalog={catalog}
                    result={recommendations}
                    onSelect={openActivity}
                  />
                )}
                {view === "history" && (
                  <ParticipationHistory
                    employee={employee}
                    catalog={catalog}
                    onSelect={openActivity}
                  />
                )}
              </>
            )}
          </>
        )}
        {catalog && view === "hr" && session.role === "hr" && (
          <>
            {hrError && (
              <div role="alert" className="error-panel">
                {hrError}
                <button
                  className="secondary"
                  onClick={() => setHrRefresh((value) => value + 1)}
                >
                  Повторить
                </button>
              </div>
            )}
            {hrLoading && (
              <div className="loading-panel" role="status">
                Обновляем HR-обзор…
              </div>
            )}
            {hr && (
              <HrDashboard
                overview={hr}
                catalog={catalog}
                directory={directory}
                search={directorySearch}
                onSearch={(value) => {
                  setDirectorySearch(value);
                  setDirectoryOffset(0);
                }}
                directoryLoading={directoryLoading}
                directoryError={directoryError}
                offset={directoryOffset}
                onPage={setDirectoryOffset}
                onEmployee={(id) => chooseEmployee(id, true)}
                onImport={() => {
                  setError("");
                  setDialog("import");
                }}
              />
            )}
          </>
        )}
        <footer>
          <a className="brand" href="/employee">
            <Compass size={18} />
            career<span>quest</span>
          </a>
          <span>Развитие, в котором есть смысл.</span>
          <button disabled={mutationBusy} onClick={refreshAll}>
            <RefreshCw size={13} />
            Обновить данные
          </button>
        </footer>
      </main>
      <dialog
        ref={modalRef}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <button
          className="close"
          disabled={mutationBusy}
          aria-label="Закрыть"
          onClick={closeDialog}
        >
          <X size={18} />
        </button>
        <div className="modal-content">
          {selection && catalog && (
            <ActivityDetails
              selection={selection}
              catalog={catalog}
              busy={mutationBusy}
              onComplete={() => void completeSelection()}
            />
          )}
          {dialog === "goal" && employee && catalog && (
            <>
              <span className="eyebrow">ВАША ТРАЕКТОРИЯ</span>
              <h2>Куда хотите двигаться?</h2>
              <p className="modal-lead">
                Можно выбрать следующий грейд или другую профессию. Требования
                берутся из каталога компании.
              </p>
              <label className="field-label">
                Целевая роль и уровень
                <select
                  aria-label="Целевая роль и уровень"
                  value={draftGoal}
                  disabled={mutationBusy}
                  onChange={(event) => setDraftGoal(event.target.value)}
                >
                  <option value="">Сбросить цель и получить предложение</option>
                  {catalog.role_profiles.map((profile) => {
                    const value = JSON.stringify({
                      target_role: profile.role,
                      target_grade: profile.grade,
                    });
                    return (
                      <option key={value} value={value}>
                        {profile.grade} · {profile.role}
                      </option>
                    );
                  })}
                </select>
              </label>
              <p className="fine-print">
                Процент покрытия пересчитывается относительно новой цели.
                Изменение цели само по себе не меняет ваши навыки или должность.
              </p>
              <button
                className="primary"
                disabled={mutationBusy}
                onClick={() => void saveGoal()}
              >
                {mutationBusy ? "Сохраняем…" : "Сохранить цель"}
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {dialog === "import" && catalog && session.role === "hr" && (
            <ImportPanel
              datasetRevision={catalog.dataset_revision}
              onBusyChange={(busy) => {
                mutationLock.current = busy;
                setMutationBusy(busy);
              }}
              onCommitted={() => {
                setDataRefresh((value) => value + 1);
                setToast("Импорт обработан. Обновляем данные команды.");
              }}
            />
          )}
          {error && (
            <div role="alert" className="error-panel spaced">
              {error}
            </div>
          )}
        </div>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Скрыть уведомление" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
