"use client";
import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Target,
  Layers3,
  BookOpen,
  LayoutDashboard,
  Activity,
  LibraryBig,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  CatalogView,
  RecommendationCard as Card,
} from "../../../../contracts/backend";
import { endpoints } from "@/lib/api";
import {
  formats,
  eventTypes,
  emptyReasons,
  goalSources,
  activityDate,
} from "@/lib/labels";
import { useEmployee } from "@/hooks/use-employee";
import { useResource } from "@/hooks/use-resource";
import { Failure, Loading } from "./feedback";
import { Modal } from "./modal";
import { Skills } from "./skills";
import { History } from "./history";
import { RecommendationCard } from "./recommendation-card";

export function Employee({
  id,
  onError,
  onChanged,
  viewer = "employee",
}: {
  id: string;
  onError: (error: unknown) => void;
  onChanged?: () => void;
  viewer?: "employee" | "hr";
}) {
  const state = useEmployee(id, onError, onChanged);
  const catalog = useResource<CatalogView>(endpoints.catalog, onError);
  const [tab, setTab] = useState("overview");
  const [selection, setSelection] = useState<{
    card: Card;
    result: typeof state.recommendations;
  }>();
  const selected =
    selection?.result === state.recommendations ? selection?.card : undefined;
  const setSelected = (card: Card | undefined) =>
    setSelection(card ? { card, result: state.recommendations } : undefined);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalIndex, setGoalIndex] = useState("");
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("all");
  const p = state.profile;
  const names = Object.fromEntries(
    catalog.data?.skills.map((s) => [s.skill_id, s.name]) ?? [],
  );
  const disabled = state.busy || !!state.pendingTarget;
  const isHr = viewer === "hr";
  function openGoal() {
    const index = catalog.data?.role_profiles.findIndex(
      (g) => g.role === p?.goal.target?.target_role && g.grade === p?.goal.target?.target_grade,
    ) ?? -1;
    setGoalIndex(index < 0 ? "" : String(index));
    setGoalOpen(true);
  }
  return (
    <>
      {state.loading && <Loading>Загрузка профиля…</Loading>}
      <Failure error={state.error} retry={() => void state.refresh()} />
      <Failure
        error={state.mutationError}
        retry={
          state.pendingTarget && !state.busy
            ? () => void state.retryCompletion()
            : undefined
        }
      />
      {state.notice && (
        <p className="feedback success" role="status">
          {state.notice}
        </p>
      )}
      {state.pendingTarget && !state.busy && (
        <p className="feedback">
          Результат запроса не подтверждён. Повторите то же завершение; ключ
          действия сохранён.
        </p>
      )}
      {p && (
        <>
          <div className="page-top employee-heading">
            <div className="profile-identity">
              <span className="profile-avatar" aria-hidden="true">{p.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span>
              <span className="eyebrow">{isHr ? "ПРОФИЛЬ СОТРУДНИКА · HR" : "МОЙ ПРОФИЛЬ"}</span>
              <h1>{p.full_name}</h1>
              <p>
                {p.department} · {p.role} · {p.grade}
              </p>
              <p>
                Стаж: {p.tenure_months} мес. · Последняя оценка:{" "}
                {p.last_review_date}
              </p>
            </div>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => void state.refresh()}
            >
              <RefreshCw size={16} aria-hidden="true" /> Обновить профиль
            </button>
          </div>
          {isHr && (
            <section className="hr-actions" aria-label="Действия HR">
              <div>
                <span className="eyebrow">ДЕЙСТВИЯ HR</span>
                <h2>Развитие сотрудника</h2>
                <p>Выберите цель для {p.full_name}, изучите обучение или оцените результат симуляции.</p>
              </div>
              <div className="hr-action-buttons">
                <button className="primary" disabled={disabled || !catalog.data} onClick={openGoal}><Target size={17} aria-hidden="true" />{p.goal.target ? "Изменить цель" : "Назначить цель"}</button>
                <button className="secondary" onClick={() => setTab("catalog")}><LibraryBig size={17} aria-hidden="true" />Подобрать обучение</button>
                <button className="secondary" onClick={() => setTab("history")}><Activity size={17} aria-hidden="true" />История сотрудника</button>
              </div>
            </section>
          )}
          <nav className="subnav" aria-label="Разделы профиля">
            {[
              ["overview", "Обзор"],
              ["history", isHr ? "Активность сотрудника" : "Моя активность"],
              ["catalog", "Каталог"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "selected" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => setTab(key)}
              >
                {key === "overview" ? (
                  <LayoutDashboard size={17} aria-hidden="true" />
                ) : key === "history" ? (
                  <Activity size={17} aria-hidden="true" />
                ) : (
                  <LibraryBig size={17} aria-hidden="true" />
                )}
                {label}
              </button>
            ))}
          </nav>
          {tab === "overview" && (
            <>
              <section className="goal-summary" aria-label="Карьерная цель">
                <div className="goal-summary-copy">
                  <span className="goal-label">Карьерная цель</span>
                  <h2>{p.goal.target ? `${p.goal.target.target_grade} ${p.goal.target.target_role}` : "Выберите направление развития"}</h2>
                  <p>{goalSources[p.goal.source]}{p.has_simulated_progress ? " · Включает симуляции" : ""}</p>
                </div>
                <div className="goal-summary-progress">
                  <div><span>Соответствие навыков</span><strong>{p.progress ? `${Math.round(p.progress.coverage * 100)}%` : "—"}</strong></div>
                  <progress max={100} value={p.progress ? Math.round(p.progress.coverage * 100) : 0} aria-label="Соответствие навыков цели" />
                </div>
                  <button
                    className="secondary"
                    disabled={disabled || !catalog.data}
                    onClick={openGoal}
                  >
                    {p.goal.target ? "Изменить цель" : "Выбрать цель"}
                  </button>
              </section>
              <section
                className="growth-dashboard"
                aria-label="Развитие в цифрах"
              >
                <div className="growth-metric mint">
                  <Layers3 size={23} aria-hidden="true" />
                  <div>
                    <strong>{p.skills.length}</strong>
                    <span>навыков в профиле</span>
                  </div>
                  <small>{isHr ? "Профессиональный капитал сотрудника" : "Ваш профессиональный капитал"}</small>
                </div>
                <div className="growth-metric gold">
                  <Target size={23} aria-hidden="true" />
                  <div>
                    <strong>
                      {p.goal.target
                        ? p.skills.filter((s) => (s.gap ?? 0) > 0).length
                        : "—"}
                    </strong>
                    <span>навыков для развития</span>
                  </div>
                  <small>
                    {p.goal.target
                      ? "Фокус на требованиях цели"
                      : "Выберите цель, чтобы увидеть разрывы"}
                  </small>
                </div>
                <button
                  className="growth-metric lilac"
                  onClick={() => setTab("history")}
                >
                  <BookOpen size={23} aria-hidden="true" />
                  <div>
                    <strong>
                      {
                        p.history.filter(
                          (r) => r.effective_status === "in_progress",
                        ).length
                      }
                    </strong>
                    <span>активностей в процессе</span>
                  </div>
                  <small>
                    Продолжить обучение{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </small>
                </button>
              </section>
              <div className="employee-workspace">
              <section className="recommendations-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{isHr ? "ПОДОБРАНО ДЛЯ СОТРУДНИКА" : "ПОДОБРАНО ДЛЯ ВАШЕГО РОСТА"}</span>
                    <h2>Рекомендованное обучение</h2>
                  </div>
                  <button
                    className="text-button"
                    disabled={disabled || state.recLoading}
                    onClick={state.retryRecommendations}
                  >
                    Обновить подборку
                  </button>
                </div>
                {state.recLoading && (
                  <Loading>
                    Подбираем рекомендации. Профиль и история уже доступны.
                  </Loading>
                )}
                <Failure
                  error={state.recError}
                  retry={
                    !disabled && !state.recLoading
                      ? state.retryRecommendations
                      : undefined
                  }
                />
                {state.recommendations && (
                  <>
                    <div className="insight">
                      <Sparkles size={18} aria-hidden="true" />
                      <p>
                        {state.recommendations.mode === "ai"
                          ? "AI-подборка · проверенные сервером факты"
                          : state.recommendations.mode === "rules_fallback"
                            ? "Резервная подборка по правилам · без AI"
                            : emptyReasons[state.recommendations.empty_reason]}
                      </p>
                    </div>
                    <p className="fine-print">
                      Варианты следующего шага. Ожидаемые
                      приросты не складываются.
                    </p>
                    <div className="course-grid">
                      {state.recommendations.recommendations.map((card) => (
                        <RecommendationCard
                          key={card.candidate_id}
                          card={card}
                          employee={p}
                          names={names}
                          select={() => setSelected(card)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
              <Skills employee={p} names={names} />
              </div>
            </>
          )}
          {tab === "history" && (
            <History
              rows={p.history}
              busy={disabled}
              complete={(target) => void state.complete(target)}
            />
          )}
          {tab === "catalog" && (
            <>
              <div className="catalog-banner">
                <div>
                  <span className="eyebrow">БИБЛИОТЕКА ВОЗМОЖНОСТЕЙ</span>
                  <h2>Каталог обучения</h2>
                  <p>
                    Курсы, практикумы и встречи.
                  </p>
                </div>
                <div className="catalog-banner-icon" aria-hidden="true">
                  <LibraryBig size={58} />
                  <Sparkles size={22} />
                </div>
              </div>
              <div className="toolbar">
                <label className="search">
                  Поиск
                  <input
                    aria-label="Поиск по каталогу"
                    ref={searchInput}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label>
                  Тип
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="all">Все</option>
                    {Object.entries(eventTypes).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="fine-print">
                Все активности каталога. Подходящие вам шаги и доступные
                действия — в разделе «Обзор».
              </p>
              <div className="course-grid">
                {catalog.data?.events
                  .filter(
                    (e) =>
                      (type === "all" || e.type === type) &&
                      `${e.title} ${e.description}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((e) => (
                    <article className="course-card" key={e.event_id}>
                      <span className="catalog-row-icon" aria-hidden="true"><BookOpen size={22} /></span>
                      <div className="course-body">
                        <span className="outline-tag">
                          {eventTypes[e.type]}
                        </span>
                        <h3>{e.title}</h3>
                        <details className="catalog-description"><summary>Описание программы</summary><p>{e.description}</p></details>
                        <p>
                          {formats[e.format]} · {e.duration_hours} ч.
                        </p>
                        <p>
                          {e.upcoming_sessions.join(", ") ||
                            (e.format === "self_paced"
                              ? "В своём темпе"
                              : "Нет запланированных сессий")}
                        </p>
                        {e.mandatory && (
                          <p>
                            Обязательное обучение · не персональная рекомендация
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
              {catalog.data &&
                !catalog.data.events.some(
                  (e) =>
                    (type === "all" || e.type === type) &&
                    `${e.title} ${e.description}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                ) && (
                  <div className="empty">
                    <p>Ничего не найдено.</p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setQuery("");
                        setType("all");
                        searchInput.current?.focus();
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  </div>
                )}
            </>
          )}
          {selected &&
            state.recommendations?.recommendations.some(
              (c) => c.candidate_id === selected.candidate_id,
            ) && (
              <Modal
                title={selected.title}
                close={() => setSelected(undefined)}
              >
                {isHr && <p className="modal-employee">Сотрудник: <strong>{p.full_name}</strong></p>}
                <p>
                  {formats[selected.format]} · {selected.duration_hours} ч. ·{" "}
                  {activityDate(selected.format, selected.session_date)}
                </p>
                <ul className="verified-facts">
                  {selected.facts
                    .filter((f) => selected.reason_fact_ids.includes(f.fact_id))
                    .map((f) => (
                      <li key={f.fact_id}>{f.text}</li>
                    ))}
                </ul>
                <div className="skill-outcomes">
                  {selected.expected_skill_changes.map((change) => (
                    <p key={change.skill_id}>
                      <strong>
                        {names[change.skill_id] ?? change.skill_id}
                      </strong>
                      <span>
                        {change.before} → {change.after} · цель{" "}
                        {p.skills.find((s) => s.skill_id === change.skill_id)
                          ?.required_level ?? "—"}
                      </span>
                    </p>
                  ))}
                </div>
                {selected.alternative && (
                  <>
                    <h3>Сравнение: {selected.alternative.title}</h3>
                    <ul>
                      {selected.alternative.facts.map((f) => (
                        <li key={f.fact_id}>{f.text}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="fine-print">
                  Завершение — симуляция сценария, не подтверждение фактического
                  посещения. Навыки обновятся после ответа сервера.
                </p>
                <button
                  className="primary"
                  disabled={
                    disabled ||
                    (selected.action === "continue" &&
                      !selected.participation_id)
                  }
                  onClick={() => {
                    void state.complete(
                      selected.action === "continue" &&
                        selected.participation_id
                        ? {
                            kind: "existing_participation",
                            participation_id: selected.participation_id,
                          }
                        : {
                            kind: "new_participation",
                            event_id: selected.event_id,
                            session_date: selected.session_date,
                          },
                    );
                    setSelected(undefined);
                  }}
                >
                  Симулировать завершение
                </button>
              </Modal>
            )}
          {goalOpen && (
            <Modal title={isHr ? "Карьерная цель сотрудника" : "Ваше направление"} close={() => setGoalOpen(false)}>
              {isHr && <p className="modal-employee">Сотрудник: <strong>{p.full_name}</strong></p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const target = catalog.data?.role_profiles[Number(goalIndex)];
                  if (target && goalIndex !== "") {
                    void state.changeGoal({
                      target_role: target.role,
                      target_grade: target.grade,
                    });
                    setGoalOpen(false);
                  }
                }}
              >
                <label className="field-label">
                  Профессия и грейд
                  <select
                    required
                    value={goalIndex}
                    onChange={(e) => setGoalIndex(e.target.value)}
                  >
                    <option value="">Выберите цель</option>
                    {catalog.data?.role_profiles.map((g, i) => (
                      <option key={`${g.role}-${g.grade}`} value={i}>
                        {g.role} · {g.grade}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={disabled}>
                  Сохранить
                </button>
              </form>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  void state.changeGoal(null);
                  setGoalOpen(false);
                }}
              >
                Убрать явную цель
              </button>
              <p className="fine-print">
                Сервер может предложить следующий грейд текущей роли.
              </p>
            </Modal>
          )}
        </>
      )}
      {catalog.loading && <Loading>Загрузка справочника…</Loading>}
      <Failure error={catalog.error} retry={catalog.reload} />
    </>
  );
}
