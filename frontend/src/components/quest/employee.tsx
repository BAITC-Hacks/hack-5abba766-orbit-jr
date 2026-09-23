"use client";
import { useRef, useState } from "react";
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
import { CareerJourney } from "./career-journey";
import { CompletionResultPanel } from "./completion-result";
import { LearningPlayer } from "./learning-player";

export function Employee({
  id,
  onError,
  onChanged,
}: {
  id: string;
  onError: (error: unknown) => void;
  onChanged?: () => void;
}) {
  const state = useEmployee(id, onError, onChanged);
  const catalog = useResource<CatalogView>(endpoints.catalog, onError);
  const modules = useResource<{ modules: LearningModuleSummary[] }>(endpoints.learningModules, onError);
  const [learning, setLearning] = useState<{ moduleId: string; event: EventView; target: CompletionRequest["target"] }>();
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
  const eventNames = Object.fromEntries(catalog.data?.events.map(event => [event.event_id, event.title]) ?? []);
  const learningModules = modules.data?.modules ?? [];
  const moduleFor = (eventId: string) => learningModules.find(module => module.event_id === eventId);
  const disabled = state.busy || !!state.pendingTarget;
  function openLearning(moduleId: string, eventId: string, target?: CompletionRequest["target"]) {
    const event = catalog.data?.events.find(item => item.event_id === eventId);
    if (!event || !p || disabled) return;
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
    if (module) openLearning(module.id, card.event_id, cardTarget(card));
    else setSelected(card);
  }
  if (learning && p) return <LearningPlayer key={`${id}:${learning.moduleId}`} employee={p} moduleId={learning.moduleId} event={learning.event} target={learning.target} names={names} onError={onError}
    onClose={() => setLearning(undefined)} onCompleted={(result, previousProgress) => {
      setLearning(undefined);
      setTab("overview");
      void state.acceptLearningCompletion(result, previousProgress);
    }} />;
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
          Результат пока не подтверждён. Повторите завершение — повторного начисления не будет.
        </p>
      )}
      {p && (
        <>
          <div className="page-top">
            <div>
              <span className="eyebrow">ВАША КАРЬЕРА. ВАШ МАРШРУТ.</span>
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
              Обновить профиль
            </button>
          </div>
          <nav className="subnav" aria-label="Разделы профиля">
            {[
              ["overview", "Обзор"],
              ["history", "Моя активность"],
              ["catalog", "Каталог"],
              ["learning", "Учебная мастерская"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "selected" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="pill">{goalSources[p.goal.source]}</span>
                  <h2>
                    Следующая глава.
                    <br />
                    <span>
                      {p.goal.target
                        ? `${p.goal.target.target_grade} ${p.goal.target.target_role}`
                        : "Выберите направление."}
                    </span>
                  </h2>
                  <p>
                    {p.goal.target
                      ? "Ваши навыки и требования выбранной траектории."
                      : "Определите профессию и грейд, к которым хотите двигаться."}
                  </p>
                  <button
                    className="primary"
                    disabled={disabled || !catalog.data}
                    onClick={() => {
                      const index =
                        catalog.data?.role_profiles.findIndex(
                          (g) =>
                            g.role === p.goal.target?.target_role &&
                            g.grade === p.goal.target?.target_grade,
                        ) ?? -1;
                      setGoalIndex(index < 0 ? "" : String(index));
                      setGoalOpen(true);
                    }}
                  >
                    Выбрать цель
                  </button>
                </div>
                <div
                  className="orbit-scene"
                  aria-label="Соответствие навыков цели"
                >
                  <div className="orbital orbit-one" />
                  <div className="orbital orbit-two" />
                  <div className="planet-glow" />
                  <div className="progress-orb">
                    <span>СООТВЕТСТВИЕ ЦЕЛИ</span>
                    <strong>
                      {p.progress ? Math.round(p.progress.coverage * 100) : "—"}
                      {p.progress && <small>%</small>}
                    </strong>
                    <p>навыков для выбранной цели</p>
                  </div>
                </div>
                <div className="hero-foot">
                  <span>
                    {p.role} · {p.grade}
                  </span>
                  <span>
                    {p.has_simulated_progress
                      ? "С учётом демопрохождений"
                      : "По оценке навыков и истории"}
                  </span>
                </div>
              </section>
              {state.completion && <CompletionResultPanel result={state.completion.result} previousProgress={state.completion.previousProgress} names={names} onClose={state.dismissCompletion} />}
              <CareerJourney employee={p} recommendations={state.recommendations} names={names} eventNames={eventNames} onSelect={chooseCard} />
              <section>
                <div className="section-heading">
                  <h2>Ваш следующий шаг</h2>
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
                      <p>
                        {state.recommendations.mode === "ai"
                          ? "AI-подборка · проверенные сервером факты"
                          : state.recommendations.mode === "rules_fallback"
                            ? "Резервная подборка по правилам · без AI"
                            : emptyReasons[state.recommendations.empty_reason]}
                      </p>
                    </div>
                    <p className="fine-print">
                      Карточки — альтернативы следующего шага. Ожидаемые
                      приросты не складываются.
                    </p>
                    <div className="course-grid">
                      {state.recommendations.recommendations.map((card) => (
                        <RecommendationCard
                          key={card.candidate_id}
                          card={card}
                          employee={p}
                          names={names}
                          eventNames={eventNames}
                          actionLabel={moduleFor(card.event_id) ? "Открыть уроки" : "Подробнее о шаге"}
                          select={() => chooseCard(card)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
              <Skills employee={p} names={names} />
            </>
          )}
          {tab === "history" && (
            <History
              rows={p.history}
              busy={disabled}
              complete={(target) => void state.complete(target)}
              moduleEventIds={learningModules.map(module => module.event_id)}
              learn={row => {
                const module = moduleFor(row.event_id);
                if (module) openLearning(module.id, row.event_id, { kind: "existing_participation", participation_id: row.participation_id });
              }}
            />
          )}
          {tab === "catalog" && (
            <>
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
                Здесь собраны все активности компании. Подходящие вам шаги —
                в разделе «Обзор». Для некоторых курсов доступны короткие
                учебные демомодули.
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
                      <div className="course-body">
                        <span className="outline-tag">
                          {eventTypes[e.type]}
                        </span>
                        <h3>{e.title}</h3>
                        <p>{e.description}</p>
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
                        {moduleFor(e.event_id) && <button className="text-button" disabled={disabled} onClick={() => openLearning(moduleFor(e.event_id)!.id, e.event_id)}>Открыть демомодуль →</button>}
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
          {tab === "learning" && <section className="learning-library">
            <span className="eyebrow">ОТ ПРОЧИТАННОГО К ПОНЯТНОМУ</span><h2>Учебная мастерская</h2>
            <p>Короткие уроки, практические вопросы и сохранённый прогресс. Это демонстрационные фрагменты курсов; перед началом проверим доступность активности для вашего профиля.</p>
            {modules.loading && <Loading>Загрузка учебных модулей…</Loading>}
            <Failure error={modules.error} retry={modules.reload} />
            <div className="learning-library-grid">{learningModules.map(module => <article className="learning-library-card" key={module.id}>
              <span>{module.estimated_minutes} минут · {module.lesson_count} урока · мини-тест</span><h3>{module.title}</h3><p>{module.summary}</p>
              <button className="secondary" disabled={disabled || !catalog.data} onClick={() => openLearning(module.id, module.event_id)}>Открыть модуль →</button>
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
                  Отметить активность выполненной
                </button>
              </Modal>
            )}
          {goalOpen && (
            <Modal title="Ваше направление" close={() => setGoalOpen(false)}>
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
