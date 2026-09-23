"use client";
import { useState } from "react";
import type {
  CatalogView,
  RecommendationCard as Card,
} from "../../../../contracts/backend";
import { endpoints } from "@/lib/api";
import { formats, eventTypes, emptyReasons, goalSources } from "@/lib/labels";
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
}: {
  id: string;
  onError: (error: unknown) => void;
  onChanged?: () => void;
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
  const [type, setType] = useState("all");
  const p = state.profile;
  const names = Object.fromEntries(
    catalog.data?.skills.map((s) => [s.skill_id, s.name]) ?? [],
  );
  const disabled = state.busy || !!state.pendingTarget;
  return (
    <>
      {state.loading && <Loading>Загрузка профиля…</Loading>}
      <Failure error={state.error} retry={() => void state.refresh()} />
      <Failure
        error={state.mutationError}
        retry={
          state.pendingTarget ? () => void state.retryCompletion() : undefined
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
          <div className="subnav">
            {[
              ["overview", "Обзор"],
              ["history", "Моя активность"],
              ["catalog", "Каталог"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
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
                      setGoalIndex("");
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
                    <p>по расчёту сервера</p>
                  </div>
                </div>
                <div className="hero-foot">
                  <span>
                    {p.role} · {p.grade}
                  </span>
                  <span>
                    {p.has_simulated_progress
                      ? "Включает симуляции"
                      : "Рассчитанные навыки"}
                  </span>
                </div>
              </section>
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
                  retry={state.retryRecommendations}
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
                          select={() => setSelected(card)}
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
            />
          )}
          {tab === "catalog" && (
            <>
              <div className="toolbar">
                <label className="search">
                  Поиск
                  <input
                    aria-label="Поиск по каталогу"
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
                Справочник активностей. Каталог не содержит персонального
                допуска и API зачисления; доступные действия находятся в
                рекомендациях.
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
                ) && <p className="empty">Ничего не найдено.</p>}
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
                <p>
                  {formats[selected.format]} · {selected.duration_hours} ч. ·{" "}
                  {selected.session_date ?? "В своём темпе"}
                </p>
                <ul className="verified-facts">
                  {selected.facts
                    .filter((f) => selected.reason_fact_ids.includes(f.fact_id))
                    .map((f) => (
                      <li key={f.fact_id}>{f.text}</li>
                    ))}
                </ul>
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
