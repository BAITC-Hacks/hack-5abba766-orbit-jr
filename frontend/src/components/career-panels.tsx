"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  Layers,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useState } from "react";
import type {
  Candidate,
  CatalogView,
  EmployeeDirectory,
  EmployeeView,
  EventView,
  HrOverview,
  ParticipationView,
  RecommendationResult,
} from "../../../contracts/backend";

export const statusLabels: Record<string, string> = {
  completed: "Завершено",
  in_progress: "В процессе",
  dropped: "Прервано",
  no_show: "Не посетил",
  declined: "Отказ",
  overdue: "Просрочено",
};
export const goalLabels: Record<string, string> = {
  imported: "Цель из профиля",
  selected: "Выбранная цель",
  suggested: "Предложенная цель",
  missing: "Цель не определена",
};
export const typeLabels: Record<string, string> = {
  compliance: "Обязательное",
  onboarding: "Адаптация",
  course: "Курс",
  workshop: "Воркшоп",
  mentoring: "Наставничество",
  certification: "Сертификация",
  meetup: "Встреча",
};
export const formatLabels: Record<string, string> = {
  online: "Онлайн",
  offline: "Очно",
  self_paced: "В своём темпе",
};
export const emptyLabels: Record<string, string> = {
  GOAL_REQUIRED: "Выберите карьерную цель, чтобы построить следующий шаг.",
  GOAL_REACHED:
    "Требования выбранной цели покрыты. Можно выбрать новое направление развития.",
  NO_ELIGIBLE_EVENTS:
    "Сейчас нет доступных активностей с подходящими условиями участия.",
  NO_BENEFICIAL_EVENTS: "Доступные активности пока не дают прироста навыков.",
  NO_GOAL_RELEVANT_EVENTS:
    "В каталоге пока нет шага, который сокращает разрыв до этой цели или открывает подходящий курс.",
};
const fallbackLabels: Record<string, string> = {
  missing_api_key: "AI не настроен",
  provider_timeout: "AI не успел ответить",
  provider_error: "AI временно недоступен",
  invalid_response: "Ответ AI не прошёл проверку",
};
export const skillName = (catalog: CatalogView, id: string) =>
  catalog.skills.find((s) => s.skill_id === id)?.name ?? id;
export const dateLabel = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`))
    : "Без даты";
export type ActivitySelection = {
  event: EventView;
  candidate?: Candidate;
  participation?: ParticipationView;
};

function ActivityCard({
  event,
  candidate,
  index = 0,
  onSelect,
}: {
  event: EventView;
  candidate?: Candidate;
  index?: number;
  onSelect: (selection: ActivitySelection) => void;
}) {
  const accent = ["blue", "peach", "green"][index % 3];
  return (
    <article className="course-card">
      <button
        className={`course-art ${accent}`}
        onClick={() => onSelect({ event, candidate })}
        aria-label={`Подробнее: ${event.title}`}
      >
        <span className="art-label">
          {typeLabels[event.type]}
          {event.mandatory ? " · обязательно" : ""}
        </span>
        <div className={`sculpture ${accent}`} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="art-arrow">
          <ArrowUpRight size={19} />
        </span>
      </button>
      <div className="course-body">
        <div className="course-meta">
          <span>{formatLabels[event.format]}</span>
          <span>·</span>
          <span>{event.duration_hours} ч</span>
        </div>
        <h3>{event.title}</h3>
        <p>
          {candidate
            ? candidate.relevance === "prerequisite"
              ? "Подготовительный шаг: открывает доступ к следующей активности."
              : (candidate.facts.find((f) => f.category === "skill_gap")
                  ?.text ?? "Подходит вашему профилю и истории развития.")
            : event.description}
        </p>
        <div className="course-bottom">
          <span className="gain">
            {candidate
              ? candidate.goal_coverage_delta > 0
                ? `+${(candidate.goal_coverage_delta * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} п.п. к цели`
                : candidate.relevance === "prerequisite"
                  ? "Открывает следующий шаг"
                  : "Развитие навыков"
              : event.mandatory
                ? "Вне рекомендаций"
                : "Каталог компании"}
          </span>
          <button
            className="text-button"
            onClick={() => onSelect({ event, candidate })}
          >
            {candidate?.action === "continue" ? "Продолжить" : "Подробнее"}
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Recommendations({
  result,
  loading,
  error,
  catalog,
  onRetry,
  onSelect,
}: {
  result: RecommendationResult | null;
  loading: boolean;
  error: string;
  catalog: CatalogView;
  onRetry: () => void;
  onSelect: (selection: ActivitySelection) => void;
}) {
  return (
    <section id="next-steps">
      <div className="section-heading">
        <div>
          <span className="eyebrow">В НУЖНОМ НАПРАВЛЕНИИ</span>
          <h2>Ваш следующий шаг.</h2>
        </div>
        <button className="text-button" disabled={loading} onClick={onRetry}>
          Обновить
          <Sparkles size={16} />
        </button>
      </div>
      <div className="insight">
        <span className="insight-icon">
          <Sparkles size={21} />
        </span>
        <div>
          <strong>
            {loading
              ? "Подбираем варианты по вашему профилю…"
              : result?.mode === "ai"
                ? "Персональный выбор AI, проверенный по данным."
                : result?.mode === "rules_fallback"
                  ? "Персональный подбор по правилам."
                  : "Развитие с учётом ваших возможностей."}
          </strong>
          <p>
            {result?.mode === "rules_fallback"
              ? `${fallbackLabels[result.fallback_reason]}. Навыки, требования роли и история учтены сервером.`
              : "Карточки — альтернативы следующего шага. После одного выполнения подбор обновится."}
          </p>
        </div>
        <span className="outline-tag">
          {loading
            ? "Подбираем"
            : result?.mode === "ai"
              ? "AI"
              : result?.mode === "rules_fallback"
                ? "По правилам"
                : "Траектория"}
        </span>
      </div>
      {error && (
        <div role="alert" className="error-panel">
          {error}
          <button className="secondary" onClick={onRetry} disabled={loading}>
            Повторить подбор
          </button>
        </div>
      )}
      {loading && (
        <div className="loading-panel" role="status">
          Сравниваем разрывы, предварительные требования и историю…
        </div>
      )}
      {!loading && result?.mode === "no_candidates" && (
        <div className="empty">
          <Compass />
          <h3>Следующий шаг требует внимания</h3>
          <p>{emptyLabels[result.empty_reason]}</p>
        </div>
      )}
      {!loading && result && result.mode !== "no_candidates" && (
        <div className="course-grid">
          {result.recommendations.map((candidate, index) => {
            const event = catalog.events.find(
              (item) => item.event_id === candidate.event_id,
            );
            return event ? (
              <ActivityCard
                key={candidate.candidate_id}
                event={event}
                candidate={candidate}
                index={index}
                onSelect={onSelect}
              />
            ) : null;
          })}
        </div>
      )}
    </section>
  );
}

export function EmployeeOverview({
  employee,
  catalog,
  result,
  recommendationsLoading,
  recommendationsError,
  onRetry,
  onGoal,
  onSelect,
}: {
  employee: EmployeeView;
  catalog: CatalogView;
  result: RecommendationResult | null;
  recommendationsLoading: boolean;
  recommendationsError: string;
  onRetry: () => void;
  onGoal: () => void;
  onSelect: (selection: ActivitySelection) => void;
}) {
  const progress = employee.progress
    ? Math.round(employee.progress.coverage * 100)
    : null;
  const required = employee.skills.filter((s) => (s.required_level ?? 0) > 0);
  const target = employee.goal.target;
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="pill">
            <span className="status-dot" />
            Ваша траектория
          </span>
          <h2>
            Следующая глава.
            <br />
            <span>
              {target
                ? `${target.target_grade} ${target.target_role}`
                : "Выберите направление."}
            </span>
          </h2>
          <p>
            {employee.full_name}, ваш план строится на навыках,
            <br />
            требованиях роли и истории обучения.
          </p>
          <button
            className="primary"
            onClick={() =>
              document
                .getElementById("next-steps")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            К следующим шагам
            <ArrowRight size={17} />
          </button>
          <button className="hero-link" onClick={onGoal}>
            Изменить цель
            <ChevronRight size={15} />
          </button>
        </div>
        <div
          className="orbit-scene"
          aria-label={
            progress === null
              ? "Цель не выбрана"
              : `Покрытие требований ${progress}%`
          }
        >
          <div className="orbital orbit-one" />
          <div className="orbital orbit-two" />
          <div className="orbital orbit-three" />
          <div className="planet-glow" />
          <div className="progress-orb">
            <span>ПОКРЫТИЕ ТРЕБОВАНИЙ</span>
            <strong>
              {progress ?? "—"}
              {progress !== null && <small>%</small>}
            </strong>
            <p>
              {target
                ? `на пути к ${target.target_grade}`
                : "начните с выбора цели"}
            </p>
            <div className="orb-track">
              <i style={{ width: `${progress ?? 0}%` }} />
            </div>
          </div>
          <div className="float-label float-top">
            <Sparkles size={16} />
            <span>
              {employee.has_simulated_progress
                ? "Включает симуляции"
                : "На основе профиля и истории"}
            </span>
          </div>
          <div className="float-label float-bottom">
            <span className="small-check">
              <Check size={12} />
            </span>
            Каждый шаг — ближе к цели
          </div>
          <span className="orbit-dot dot-one" />
          <span className="orbit-dot dot-two" />
        </div>
        <div className="hero-foot">
          <span>
            {employee.role}
            <ChevronRight size={13} />
            {employee.grade}
            <ChevronRight size={13} />
            <b>{target?.target_grade ?? "Цель не выбрана"}</b>
          </span>
          <span>{goalLabels[employee.goal.source]}</span>
        </div>
      </section>
      <section className="metrics">
        <div>
          <span className="metric-icon">
            <Target size={20} />
          </span>
          <div>
            <strong>
              {required.filter((s) => s.gap === 0).length}
              <small> / {required.length}</small>
            </strong>
            <p>навыков соответствуют цели</p>
          </div>
        </div>
        <div>
          <span className="metric-icon lavender">
            <Layers size={20} />
          </span>
          <div>
            <strong>
              {employee.progress?.missing_critical_skill_ids.length ?? "—"}
            </strong>
            <p>критических разрывов до цели</p>
          </div>
        </div>
        <div>
          <span className="metric-icon mint">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <strong>
              {
                employee.history.filter(
                  (p) => p.effective_status === "completed",
                ).length
              }
            </strong>
            <p>завершено, включая симуляции</p>
          </div>
        </div>
      </section>
      <Recommendations
        result={result}
        loading={recommendationsLoading}
        error={recommendationsError}
        catalog={catalog}
        onRetry={onRetry}
        onSelect={onSelect}
      />
      <section className="skills-panel">
        <div className="skills-intro">
          <span className="eyebrow">ВИДЕТЬ СВОЙ РОСТ</span>
          <h2>
            Ваш опыт.
            <br />В новой перспективе.
          </h2>
          <p>
            Сравните текущие навыки с требованиями цели. Оценка профиля:{" "}
            {dateLabel(employee.last_review_date)}.
          </p>
          <div className="legend">
            <span>
              <i />
              Текущий уровень
            </span>
            <span>
              <i />
              До цели
            </span>
          </div>
          <small>
            Покрытие требований показывает соответствие навыков, не гарантирует
            повышение. Симуляции отделены от реального прохождения в истории.
          </small>
        </div>
        <div className="skill-list">
          {employee.skills
            .filter((s) => s.current_level > 0 || (s.required_level ?? 0) > 0)
            .map((s) => (
              <div className="skill-row" key={s.skill_id}>
                <div>
                  <span>
                    {skillName(catalog, s.skill_id)}
                    {s.critical && <span className="critical">Приоритет</span>}
                  </span>
                  <b>
                    {s.current_level}
                    <em> / {s.required_level ?? "—"}</em>
                    {s.gap === 0 && <Check size={14} />}
                  </b>
                </div>
                <div
                  className="skill-segments"
                  aria-label={`Текущий уровень ${s.current_level}, требуется ${s.required_level ?? "не задано"}`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      className={
                        i < s.current_level
                          ? "filled"
                          : i < (s.required_level ?? 0)
                            ? "needed"
                            : ""
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}

export function ActivityCatalog({
  catalog,
  result,
  onSelect,
}: {
  catalog: CatalogView;
  result: RecommendationResult | null;
  onSelect: (selection: ActivitySelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const filtered = catalog.events.filter(
    (event) =>
      (type === "all" || event.type === type) &&
      `${event.title} ${event.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Поиск по каталогу"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти возможность"
          />
        </label>
        <label className="select-wrap">
          Тип активности
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="all">Все типы</option>
            {Object.entries(typeLabels).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="catalog-count">
        {filtered.length} активностей. Симулировать выполнение можно из
        персональной рекомендации или начатого участия в истории.
      </p>
      <div className="course-grid">
        {filtered.map((event, index) => (
          <ActivityCard
            key={event.event_id}
            event={event}
            index={index}
            candidate={result?.recommendations.find(
              (c) => c.event_id === event.event_id,
            )}
            onSelect={onSelect}
          />
        ))}
      </div>
      {!filtered.length && (
        <div className="empty">
          <Search />
          <h3>Ничего не найдено</h3>
          <p>Попробуйте другое название или тип активности.</p>
        </div>
      )}
    </>
  );
}

export function ParticipationHistory({
  employee,
  catalog,
  onSelect,
}: {
  employee: EmployeeView;
  catalog: CatalogView;
  onSelect: (selection: ActivitySelection) => void;
}) {
  return (
    <section className="history-panel">
      <div className="section-heading">
        <h2>Ваш путь в деталях</h2>
        <span className="outline-tag">{employee.history.length} записей</span>
      </div>
      {employee.history.map((p) => {
        const event = catalog.events.find(
          (item) => item.event_id === p.event_id,
        );
        return (
          <div className="history-row" key={p.participation_id}>
            <span
              className={`history-icon ${p.effective_status === "completed" ? "finished" : ""}`}
            >
              {p.effective_status === "completed" ? (
                <Check size={20} />
              ) : (
                <BookOpen size={20} />
              )}
            </span>
            <div>
              <h3>{p.event_title}</h3>
              <p>
                {dateLabel(p.source_date ?? p.scheduled_session_date)} ·{" "}
                {statusLabels[p.effective_status]} · {p.completion_pct}%
              </p>
              <p>
                {p.completion_origin === "simulation"
                  ? "Симуляция выполнения"
                  : "Исходная история"}
                {p.superseded_by
                  ? " · другая попытка уже завершена, повторный прирост исключён"
                  : ""}
                {p.source_status && p.source_status !== p.effective_status
                  ? ` · исходный статус: ${statusLabels[p.source_status]}`
                  : ""}
              </p>
            </div>
            {p.actionable && event && (
              <button
                className="text-button"
                onClick={() => onSelect({ event, participation: p })}
              >
                Продолжить
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        );
      })}
      {!employee.history.length && (
        <div className="empty">
          <BookOpen />
          <h3>История пока пуста</h3>
          <p>Выберите следующий шаг в разделе развития.</p>
        </div>
      )}
    </section>
  );
}

export function HrDashboard({
  overview,
  catalog,
  directory,
  search,
  onSearch,
  directoryLoading,
  directoryError,
  offset,
  onPage,
  onEmployee,
  onImport,
}: {
  overview: HrOverview;
  catalog: CatalogView;
  directory: EmployeeDirectory | null;
  search: string;
  onSearch: (value: string) => void;
  directoryLoading: boolean;
  directoryError: string;
  offset: number;
  onPage: (offset: number) => void;
  onEmployee: (id: string) => void;
  onImport: () => void;
}) {
  const [allGaps, setAllGaps] = useState(false);
  const gaps = [...overview.skill_gaps].sort(
    (a, b) => b.employees_with_gap - a.employees_with_gap,
  );
  return (
    <>
      <div className="hr-toolbar">
        <span className="pill">
          <Users size={16} />
          HR · данные всего набора
        </span>
        <button className="primary" onClick={onImport}>
          Импорт данных
          <ArrowUpRight size={16} />
        </button>
      </div>
      <section className="hr-metrics">
        <div>
          <Users size={22} />
          <strong>{overview.employee_count}</strong>
          <p>сотрудников в наборе</p>
        </div>
        <div>
          <Target size={22} />
          <strong>{overview.no_next_step.length}</strong>
          <p>профилей без следующего шага</p>
        </div>
        <div>
          <CheckCircle2 size={22} />
          <strong>{overview.participation.simulated_completions}</strong>
          <p>симуляций выполнения</p>
        </div>
      </section>
      <div className="hr-grid">
        <section className="panel">
          <span className="eyebrow">ТОЧКИ РОСТА</span>
          <h2>Где нужна поддержка</h2>
          <p className="muted">
            Разрывы среди сотрудников, у чьей цели есть этот навык. Предложенные
            и выбранные цели показаны отдельно.
          </p>
          {(allGaps ? gaps : gaps.slice(0, 10)).map((gap) => (
            <div className="hr-bar" key={`${gap.skill_id}-${gap.goal_source}`}>
              <div>
                <span>
                  {skillName(catalog, gap.skill_id)}
                  <small className="block-muted">
                    {goalLabels[gap.goal_source]}
                  </small>
                </span>
                <b>
                  {gap.employees_with_gap} из {gap.denominator}
                </b>
              </div>
              <div>
                <i
                  style={{
                    width: `${gap.denominator ? (100 * gap.employees_with_gap) / gap.denominator : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {gaps.length > 10 && (
            <button
              className="text-button spaced"
              onClick={() => setAllGaps(!allGaps)}
            >
              {allGaps ? "Свернуть" : `Все группы (${gaps.length})`}
            </button>
          )}
          {!gaps.length && (
            <p className="muted spaced">
              Разрывов по выбранным целям не найдено.
            </p>
          )}
        </section>
        <section className="hr-note">
          <span className="note-icon">
            <Compass size={30} />
          </span>
          <h2>
            У каждого свой
            <br />
            маршрут развития.
          </h2>
          <p>
            Отсутствие подходящего шага — повод помочь с маршрутом. Обсудите
            цель или расширьте возможности обучения.
          </p>
          {Object.entries(overview.goals_by_source).map(([source, count]) => (
            <div key={source}>
              <span className="status-dot" />
              {goalLabels[source]}: {count}
            </div>
          ))}
        </section>
      </div>
      <section className="people-panel">
        <div className="section-heading">
          <h2>Сотрудники</h2>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Поиск сотрудников"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Имя, роль или отдел"
            />
          </label>
        </div>
        {directoryError && (
          <p role="alert" className="error-panel">
            {directoryError}
          </p>
        )}
        {directoryLoading && (
          <p role="status" className="muted">
            Обновляем список…
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Отдел</th>
                <th>Роль</th>
                <th>Профиль</th>
              </tr>
            </thead>
            <tbody>
              {directory?.items.map((person) => (
                <tr key={person.employee_id}>
                  <td>
                    <strong>{person.full_name}</strong>
                    <small>{person.employee_id}</small>
                  </td>
                  <td>{person.department}</td>
                  <td>
                    {person.grade} {person.role}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => onEmployee(person.employee_id)}
                    >
                      Открыть
                      <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {directory && (
          <div className="pagination">
            <span>
              {directory.total
                ? `${offset + 1}–${Math.min(offset + directory.items.length, directory.total)}`
                : "0"}{" "}
              из {directory.total}
            </span>
            <button
              className="secondary"
              disabled={offset === 0 || directoryLoading}
              onClick={() => onPage(Math.max(0, offset - 50))}
            >
              Назад
            </button>
            <button
              className="secondary"
              disabled={offset + 50 >= directory.total || directoryLoading}
              onClick={() => onPage(offset + 50)}
            >
              Далее
            </button>
          </div>
        )}
      </section>
      <section className="people-panel spaced">
        <div className="section-heading">
          <h2>Где маршрут требует внимания</h2>
          <span className="outline-tag">Без оценки мотивации</span>
        </div>
        {overview.no_next_step.length ? (
          <div className="attention-list">
            {overview.no_next_step.map((person) => (
              <div className="history-row" key={person.employee_id}>
                <div>
                  <h3>{person.full_name}</h3>
                  <p>{emptyLabels[person.reason]}</p>
                  <p>{goalLabels[person.goal_source]}</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => onEmployee(person.employee_id)}
                >
                  Открыть
                  <ChevronRight size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Для каждого профиля найден следующий шаг.</p>
        )}
      </section>
      <section className="people-panel spaced">
        <div className="section-heading">
          <h2>Участие в развитии</h2>
          <span className="outline-tag">Факты и сценарий</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Статус</th>
                <th>Исходная история</th>
                <th>С учётом симуляций</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(statusLabels).map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>
                    {
                      overview.participation.actual_by_status[
                        key as keyof typeof overview.participation.actual_by_status
                      ]
                    }
                  </td>
                  <td>
                    {
                      overview.participation.effective_by_status[
                        key as keyof typeof overview.participation.effective_by_status
                      ]
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          Перекрытых попыток: {overview.participation.superseded_attempts}. Они
          сохранены в исходной истории и исключены из итогов сценария.
        </p>
        <details className="spaced">
          <summary>
            Участие по активностям ({overview.participation.by_activity.length})
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Активность</th>
                  <th>Завершено в исходнике</th>
                  <th>В процессе в исходнике</th>
                  <th>Симуляции</th>
                  <th>Завершено в сценарии</th>
                </tr>
              </thead>
              <tbody>
                {overview.participation.by_activity.map((event) => (
                  <tr key={event.event_id}>
                    <td>{event.title}</td>
                    <td>{event.actual_by_status.completed}</td>
                    <td>{event.actual_by_status.in_progress}</td>
                    <td>{event.simulated_completions}</td>
                    <td>{event.effective_by_status.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}

export function ActivityDetails({
  selection,
  catalog,
  busy,
  onComplete,
}: {
  selection: ActivitySelection;
  catalog: CatalogView;
  busy: boolean;
  onComplete: () => void;
}) {
  const { event, candidate, participation } = selection;
  const actionable = !!candidate || !!participation?.actionable;
  return (
    <>
      <span className="eyebrow">
        {typeLabels[event.type]} · {event.event_id}
      </span>
      <h2>{event.title}</h2>
      <div className="modal-meta">
        <span>
          <Clock size={14} />
          {event.duration_hours} ч
        </span>
        <span>{formatLabels[event.format]}</span>
        {(candidate?.session_date ?? participation?.scheduled_session_date) && (
          <span>
            {dateLabel(
              candidate?.session_date ??
                participation?.scheduled_session_date ??
                null,
            )}
          </span>
        )}
      </div>
      <p className="modal-lead">{event.description}</p>
      {candidate && (
        <>
          <h3>Почему этот шаг подходит</h3>
          <ul className="fact-list">
            {candidate.facts
              .filter(
                (fact) =>
                  !("reason_fact_ids" in candidate) ||
                  (
                    candidate as Candidate & { reason_fact_ids: string[] }
                  ).reason_fact_ids.includes(fact.fact_id),
              )
              .map((fact) => (
                <li key={fact.fact_id}>
                  <Check size={15} />
                  {fact.text}
                </li>
              ))}
          </ul>
          {candidate.expected_skill_changes.length > 0 && (
            <>
              <h3>Изменения после симуляции</h3>
              <ul className="fact-list">
                {candidate.expected_skill_changes.map((change) => (
                  <li key={change.skill_id}>
                    <Check size={15} />
                    {skillName(catalog, change.skill_id)}: {change.before} →{" "}
                    {change.after} (+{change.gain})
                  </li>
                ))}
              </ul>
            </>
          )}
          {candidate.unlocks_event_ids.length > 0 && (
            <p className="modal-lead">
              Открывает доступ:{" "}
              {candidate.unlocks_event_ids
                .map(
                  (id) =>
                    catalog.events.find((item) => item.event_id === id)
                      ?.title ?? id,
                )
                .join(", ")}
              . Следующая активность будет проверена заново после выполнения.
            </p>
          )}
        </>
      )}
      {!candidate && (
        <>
          <h3>Условия участия</h3>
          <p className="modal-lead">
            Роли: {event.target_roles.join(", ")}. Уровни:{" "}
            {event.target_grades.join(", ")}.
          </p>
          <ul className="fact-list">
            {Object.entries(event.prerequisites).map(([id, level]) => (
              <li key={id}>
                {skillName(catalog, id)}: от {level}
              </li>
            ))}
          </ul>
          <h3>Эффекты из каталога</h3>
          <ul className="fact-list">
            {event.develops_skills.map((effect) => (
              <li key={effect.skill_id}>
                {skillName(catalog, effect.skill_id)}: до +{effect.gain},
                максимум уровень {effect.max_level}. Фактический прирост зависит
                от текущего уровня.
              </li>
            ))}
          </ul>
        </>
      )}
      {actionable ? (
        <>
          <p className="fine-print">
            Это симуляция: она сохранится в сценарии развития и HR-обзоре.
            Исходные записи обучения останутся неизменными.
          </p>
          <button className="primary" disabled={busy} onClick={onComplete}>
            {busy ? "Сохраняем…" : "Смоделировать выполнение"}
            <CheckCircle2 size={17} />
          </button>
        </>
      ) : (
        <p className="fine-print">
          Это описание из каталога. Для действия откройте персональные
          рекомендации или уже начатую активность в истории.
        </p>
      )}
    </>
  );
}
