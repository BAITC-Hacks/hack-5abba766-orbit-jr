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
  UserRound,
  Sparkles,
} from "lucide-react";
import type {
  CatalogView,
  CompletionRequest,
  EventView,
  RecommendationCard as Card,
} from "../../../../contracts/backend";
import type { LearningModuleSummary } from "../../../../contracts/learning";
import { endpoints } from "@/lib/api";
import {
  formats,
  eventTypes,
  emptyReasons,
  emptyGuidance,
  fallbackReasons,
  goalSources,
  activityDate,
} from "@/lib/labels";
import { useEmployee } from "@/hooks/use-employee";
import { useResource } from "@/hooks/use-resource";
import { Failure, Loading } from "./feedback";
import { Modal } from "./modal";
import { Skills } from "./skills";
import { History } from "./history";
import { CatalogSelect } from "./catalog-select";
import { RecommendationCard } from "./recommendation-card";
import { CareerJourney } from "./career-journey";
import { CompletionResultPanel } from "./completion-result";
import { LearningPlayer } from "./learning-player";
import { EmployeeProfile } from "./employee-profile";

export function Employee({
  id,
  onError,
  onChanged,
  viewer = "employee",
  readOnly: requestedReadOnly = false,
  initialTab = "overview",
}: {
  id: string;
  onError: (error: unknown) => void;
  onChanged?: () => void;
  viewer?: "employee" | "hr";
  readOnly?: boolean;
  initialTab?: "overview" | "profile";
}) {
  const readOnly = requestedReadOnly || viewer === "hr";
  const state = useEmployee(id, onError, onChanged);
  const catalog = useResource<CatalogView>(endpoints.catalog, onError);
  const modules = useResource<{ modules: LearningModuleSummary[] }>(endpoints.learningModules, onError);
  const [learning, setLearning] = useState<{ moduleId: string; event: EventView; target: CompletionRequest["target"] }>();
  const [tab, setTab] = useState<string>(initialTab);
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
  const eventNames = Object.fromEntries(catalog.data?.events.map(event => [event.event_id, event.title]) ?? []);
  const learningModules = modules.data?.modules ?? [];
  const filteredEvents = catalog.data?.events.filter(event =>
    (type === "all" || event.type === type) &&
    `${event.title} ${event.description}`.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")),
  ) ?? [];
  const moduleFor = (eventId: string) => learningModules.find(module => module.event_id === eventId);
  const disabled = state.busy || !!state.pendingTarget;
  const isHr = viewer === "hr";
  function openGoal() {
    if (readOnly) return;
    const index = catalog.data?.role_profiles.findIndex(
      (g) => g.role === p?.goal.target?.target_role && g.grade === p?.goal.target?.target_grade,
    ) ?? -1;
    setGoalIndex(index < 0 ? "" : String(index));
    setGoalOpen(true);
  }
  function openLearning(moduleId: string, eventId: string, target?: CompletionRequest["target"]) {
    const event = catalog.data?.events.find(item => item.event_id === eventId);
    if (readOnly || !event || !p || disabled) return;
    const active = p.history.find(item => item.event_id === eventId && item.actionable);
    const selectedTarget = target ?? (active
      ? { kind: "existing_participation" as const, participation_id: active.participation_id }
      : { kind: "new_participation" as const, event_id: eventId, session_date: event.format === "self_paced" ? null : [...event.upcoming_sessions].sort().find(date => !state.asOfDate || date >= state.asOfDate) ?? null });
    setSelected(undefined);
    setLearning({ moduleId, event, target: selectedTarget });
  }
  function cardTarget(card: Card): CompletionRequest["target"] {
    return card.action === "continue" && card.participation_id
      ? { kind: "existing_participation", participation_id: card.participation_id }
      : { kind: "new_participation", event_id: card.event_id, session_date: card.session_date };
  }
  function chooseCard(card: Card) {
    const module = moduleFor(card.event_id);
    if (module && !readOnly) openLearning(module.id, card.event_id, cardTarget(card));
    else setSelected(card);
  }
  if (!readOnly && learning && p) return <LearningPlayer key={`${id}:${learning.moduleId}`} employee={p} moduleId={learning.moduleId} event={learning.event} target={learning.target} names={names} onError={onError}
    onClose={() => { setLearning(undefined); void state.refresh(); }} onCompleted={(result, previousProgress) => {
      setLearning(undefined);
      setTab("overview");
      void state.acceptLearningCompletion(result, previousProgress);
    }} />;
  return (
    <>
      {state.loading && <Loading>Загрузка профиля…</Loading>}
      {state.busy && !state.loading && <Loading>Сохраняем изменения…</Loading>}
      <Failure error={state.error} retry={() => void state.refresh()} />
      {!readOnly && <Failure
        error={state.mutationError}
        retry={
          state.pendingTarget && !state.busy
            ? () => void state.retryCompletion()
            : undefined
        }
      />}
      {!readOnly && state.notice && (
        <p className="feedback success" role="status">
          {state.notice}
        </p>
      )}
      {!readOnly && state.pendingTarget && !state.busy && (
        <p className="feedback">
          Результат пока не подтверждён. Повторите завершение — повторного начисления не будет.
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
          </div>
          <nav className="subnav" aria-label="Разделы профиля">
            {[
              ["profile", "Профиль"],
              ["overview", "Обзор"],
              ["history", isHr ? "Активность сотрудника" : "Моя активность"],
              ["catalog", "Каталог"],
              ["learning", readOnly ? "Учебные модули" : "Учебная мастерская"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "selected" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => setTab(key)}
              >
                {key === "profile" ? <UserRound size={17} aria-hidden="true" /> : key === "overview" ? (
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
          {tab === "profile" && <EmployeeProfile employee={p} names={names} onGoal={openGoal} disabled={disabled || !catalog.data} readOnly={readOnly} />}
          {tab === "overview" && (
            <>
              <section className="goal-summary" aria-label="Карьерная цель">
                <div className="goal-summary-copy">
                  <span className="goal-label">Карьерная цель</span>
                  <h2>{p.goal.target ? `${p.goal.target.target_grade} ${p.goal.target.target_role}` : readOnly ? "Направление пока не выбрано" : "Выберите направление развития"}</h2>
                  <p>{goalSources[p.goal.source]}{p.has_simulated_progress ? " · Включает симуляции" : ""}</p>
                </div>
                <div className="goal-summary-progress">
                  <div><span>Соответствие навыков</span><strong>{p.progress ? `${Math.round(p.progress.coverage * 100)}%` : "—"}</strong></div>
                  <progress max={100} value={p.progress ? Math.round(p.progress.coverage * 100) : 0} aria-label="Соответствие навыков цели" />
                </div>
                  {!readOnly && <button
                    className="secondary"
                    disabled={disabled || !catalog.data}
                    onClick={openGoal}
                  >
                    {p.goal.target ? "Изменить цель" : "Выбрать цель"}
                  </button>}
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
                      ? "К цели"
                      : "Цель не выбрана"}
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
                    {readOnly ? "Посмотреть активность" : "Продолжить обучение"}{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </small>
                </button>
              </section>
              {!readOnly && state.completion && <CompletionResultPanel result={state.completion.result} previousProgress={state.completion.previousProgress} names={names} onClose={state.dismissCompletion} />}
              <CareerJourney employee={p} recommendations={state.recommendations} names={names} eventNames={eventNames} onSelect={chooseCard} readOnly={readOnly} />
              <div className="employee-workspace">
              <section className="recommendations-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{isHr ? "ПОДОБРАНО ДЛЯ СОТРУДНИКА" : "ПОДОБРАНО ДЛЯ ВАШЕГО РОСТА"}</span>
                    <h2>Рекомендованное обучение</h2>
                  </div>
                </div>
                {state.recLoading && (
                  <Loading>
                    Подбираем обучение…
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
                          ? "AI-подборка"
                          : state.recommendations.mode === "rules_fallback"
                            ? "Подборка по правилам"
                            : readOnly && state.recommendations.empty_reason === "GOAL_REQUIRED"
                              ? "Сотрудник пока не выбрал цель."
                              : emptyReasons[state.recommendations.empty_reason]}
                      </p>
                    </div>
                    {state.recommendations.mode === "no_candidates" ? (
                      <div className="empty-state">
                        <p>{readOnly && ["GOAL_REQUIRED", "GOAL_REACHED"].includes(state.recommendations.empty_reason)
                          ? "Обсудите следующий карьерный шаг с сотрудником. Цель он меняет в своём кабинете."
                          : emptyGuidance[state.recommendations.empty_reason]}</p>
                        <button className="secondary" disabled={disabled || !catalog.data}
                          onClick={() => !readOnly && state.recommendations?.mode === "no_candidates" &&
                            ["GOAL_REQUIRED", "GOAL_REACHED"].includes(state.recommendations.empty_reason)
                            ? openGoal() : setTab("catalog")}>
                          {!readOnly && ["GOAL_REQUIRED", "GOAL_REACHED"].includes(state.recommendations.empty_reason)
                            ? "Выбрать карьерную цель" : "Проверить каталог обучения"}
                        </button>
                      </div>
                    ) : null}

                    {state.recommendations.mode === "rules_fallback" && (
                      <p className="section-description">{fallbackReasons[state.recommendations.fallback_reason]}</p>
                    )}
                    <div className="course-grid">
                      {state.recommendations.recommendations.map((card) => (
                        <RecommendationCard
                          key={card.candidate_id}
                          card={card}
                          employee={p}
                          names={names}
                          eventNames={eventNames}
                          actionLabel={!readOnly && moduleFor(card.event_id) ? "Открыть уроки" : "Подробнее о шаге"}
                          readOnly={readOnly}
                          select={() => chooseCard(card)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
              <Skills employee={p} names={names} readOnly={readOnly} />
              </div>
            </>
          )}
          {tab === "history" && (
            <History
              rows={p.history}
              busy={disabled}
              readOnly={readOnly}
              complete={(target) => { if (!readOnly) void state.complete(target); }}
              moduleEventIds={learningModules.map(module => module.event_id)}
              learn={row => {
                const module = moduleFor(row.event_id);
                if (module) openLearning(module.id, row.event_id, { kind: "existing_participation", participation_id: row.participation_id });
              }}
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
                <CatalogSelect value={type} onChange={setType} options={[["all", "Все типы"], ...Object.entries(eventTypes)]} />
              </div>
              <div className="course-grid catalog-grid">
                {filteredEvents.map((e) => (
                    <article className="course-card" key={e.event_id} tabIndex={0} aria-label={e.title}>
                      <span className="catalog-row-icon" aria-hidden="true"><BookOpen size={22} /></span>
                      <div className="course-body">
                        <span className="outline-tag">
                          {eventTypes[e.type]}
                        </span>
                        <h3>{e.title}</h3>
                        <details className="catalog-description"><summary>Описание программы</summary><p>{e.description}</p></details>
                        <details className="catalog-description">
                          <summary>Условия участия</summary>
                          <p>Роли: {e.target_roles.join(", ") || "Не указаны"}.</p>
                          <p>Грейды: {e.target_grades.join(", ") || "Не указаны"}.</p>
                          {Object.keys(e.prerequisites).length ? (
                            <ul>{Object.entries(e.prerequisites).map(([skillId, level]) => (
                              <li key={skillId}>{names[skillId] ?? skillId}: уровень не ниже {level}</li>
                            ))}</ul>
                          ) : <p>Предварительные навыки не требуются.</p>}
                          <p>Персональный допуск также учитывает историю участия и дату занятия.</p>
                        </details>
                        <div className="compact-meta"><span>{formats[e.format]}</span><span>{e.duration_hours} ч.</span>{e.mandatory && <span className="required-tag">Обязательное</span>}</div>
                        {e.upcoming_sessions.length > 0 ? <details className="catalog-dates">
                          <summary>{[...e.upcoming_sessions].sort()[0]}{e.upcoming_sessions.length > 1 && <span> +{e.upcoming_sessions.length - 1} даты</span>}</summary>
                          <div className="compact-meta">{[...e.upcoming_sessions].sort().map(date => <span key={date}>{date}</span>)}</div>
                        </details> : e.format !== "self_paced" && <p>Даты уточняются</p>}
                        {moduleFor(e.event_id) && (readOnly
                          ? <span className="outline-tag">Есть демомодуль</span>
                          : <button className="text-button" disabled={disabled} onClick={() => openLearning(moduleFor(e.event_id)!.id, e.event_id)}>Открыть демомодуль →</button>)}
                      </div>
                    </article>
                  ))}
              </div>
              {catalog.data && !catalog.loading && filteredEvents.length === 0 && (
                  <div className="empty">
                    <p>{catalog.data.events.length === 0 ? "В каталоге пока нет программ обучения." : "Ничего не найдено. Попробуйте другой запрос или сбросьте фильтры."}</p>
                    {catalog.data.events.length > 0 && <button
                      className="secondary"
                      onClick={() => {
                        setQuery("");
                        setType("all");
                        searchInput.current?.focus();
                      }}
                    >
                      Сбросить фильтры
                    </button>}
                  </div>
                )}
            </>
          )}
          {tab === "learning" && <section className="learning-library">
            <span className="eyebrow">ОТ ПРОЧИТАННОГО К ПОНЯТНОМУ</span><h2>{readOnly ? "Учебные модули" : "Учебная мастерская"}</h2>
            <div className="compact-meta"><span>Демомодули</span><span>Короткие уроки</span><span>Мини-тесты</span></div>
            {modules.loading && <Loading>Загрузка учебных модулей…</Loading>}
            <Failure error={modules.error} retry={modules.reload} />
            {!modules.loading && !modules.error && modules.data && learningModules.length === 0 && <p className="empty">Учебных модулей пока нет. Другие программы доступны в каталоге.</p>}
            <div className="learning-library-grid">{learningModules.map(module => <article className="learning-library-card" key={module.id}>
              <span>{module.estimated_minutes} минут · {module.lesson_count} урока · мини-тест</span><h3>{module.title}</h3><details className="compact-details"><summary>О модуле</summary><p>{module.summary}</p></details>
              {!readOnly && <button className="secondary" disabled={disabled || !catalog.data?.events.some(event => event.event_id === module.event_id)} onClick={() => openLearning(module.id, module.event_id)}>Открыть модуль →</button>}
            </article>)}</div>
          </section>}
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
                {!readOnly && <><p className="fine-print">
                  Отметка покажет расчётный результат выполнения в этом демо. Она не подтверждает посещение внешнего мероприятия.
                </p>
                <button
                  className="primary"
                  disabled={
                    disabled ||
                    (selected.action === "continue" &&
                      !selected.participation_id)
                  }
                  onClick={() => {
                    void state.complete(cardTarget(selected));
                    setSelected(undefined);
                  }}
                >
                  Смоделировать выполнение
                </button></>}
              </Modal>
            )}
          {!readOnly && goalOpen && (
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
                <CatalogSelect label="Профессия и грейд" value={goalIndex} onChange={setGoalIndex} disabled={disabled}
                  options={[["", "Выберите цель"], ...(catalog.data?.role_profiles.map((g, i): [string, string] => [String(i), `${g.role} · ${g.grade}`]) ?? [])]} />
                <button className="primary" disabled={disabled || goalIndex === ""}>
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
      {tab !== "learning" && tab !== "profile" && <Failure error={modules.error} retry={modules.reload} />}
    </>
  );
}
