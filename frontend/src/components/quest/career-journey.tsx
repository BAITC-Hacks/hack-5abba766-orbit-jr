import { ArrowUpRight, Check, Flag, Route, Target } from "lucide-react";
import type {
  EmployeeView,
  RecommendationCard,
  RecommendationResult,
} from "../../../../contracts/backend";
import { emptyReasons, goalSources } from "@/lib/labels";

export function CareerJourney({
  employee,
  recommendations,
  names,
  eventNames,
  onSelect,
  readOnly = false,
}: {
  employee: EmployeeView;
  recommendations?: RecommendationResult;
  names: Record<string, string>;
  eventNames: Record<string, string>;
  onSelect: (card: RecommendationCard) => void;
  readOnly?: boolean;
}) {
  const target = employee.goal.target;
  const gaps = employee.skills
    .filter((skill) => (skill.gap ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        (b.gap ?? 0) - (a.gap ?? 0) ||
        (names[a.skill_id] ?? a.skill_id).localeCompare(
          names[b.skill_id] ?? b.skill_id,
          "ru",
        ),
    );
  const criticalCount = gaps.filter((skill) => skill.critical).length;
  const currentRecommendations =
    recommendations?.version.dataset_revision === employee.version.dataset_revision &&
    recommendations?.version.employee_revision === employee.version.employee_revision
      ? recommendations
      : undefined;
  const coverage = employee.progress
    ? Math.round(employee.progress.coverage * 100)
    : null;

  return (
    <section className="cq-journey" aria-label="Карьерный путь">
      <div className="cq-journey-heading">
        <div>
          <span className="cq-kicker"><Route size={14} aria-hidden="true" /> {readOnly ? "КАРЬЕРНЫЙ ПУТЬ СОТРУДНИКА" : "ВАШ КАРЬЕРНЫЙ ПУТЬ"}</span>
          <h2>Карьерный путь</h2>
        </div>
        <span className="cq-goal-source">{goalSources[employee.goal.source]}</span>
      </div>

      <ol className="cq-journey-stages">
        <li className="cq-journey-stage cq-journey-current">
          <span className="cq-stage-marker" aria-hidden="true"><Check size={17} /></span>
          <span className="cq-stage-label">СЕЙЧАС</span>
          <h3>{employee.grade}</h3>
          <p className="cq-stage-role">{employee.role}</p>
          <div className="cq-current-coverage">
            <strong>{coverage === null ? "—" : `${coverage}%`}</strong>
            <span>{coverage === null ? readOnly ? "Цель пока не выбрана" : "Выберите цель для сравнения" : "соответствие цели"}</span>
          </div>
          {employee.has_simulated_progress && <span className="cq-inline-note">С учётом демо-завершений</span>}
        </li>

        <li className="cq-journey-stage cq-journey-focus">
          <span className="cq-stage-marker" aria-hidden="true"><Target size={17} /></span>
          <span className="cq-stage-label">ФОКУС РАЗВИТИЯ</span>
          <h3>{!target ? "Нужно направление" : gaps.length ? "Что подтянуть" : "Требования закрыты"}</h3>
          {criticalCount > 0 && <span className="cq-critical-count">Критических пробелов: {criticalCount}</span>}
          {!target ? (
            <p>{readOnly ? "Сотрудник выбирает целевую роль и грейд в своём профиле." : "Выберите целевую роль и грейд в профиле."}</p>
          ) : gaps.length ? (
            <>
              <ul className="cq-gap-list">
                {gaps.slice(0, 3).map((skill) => (
                  <li key={skill.skill_id}>
                    <span>{names[skill.skill_id] ?? skill.skill_id}{skill.critical && <small>Критический</small>}</span>
                    <b>{skill.current_level}<span aria-hidden="true"> → </span><span className="cq-sr-only"> до </span>{skill.required_level}</b>
                  </li>
                ))}
              </ul>
              {gaps.length > 3 && <p className="cq-inline-note">Ещё {gaps.length - 3} — в навыках ниже.</p>}
            </>
          ) : (
            <p>Текущие навыки соответствуют требованиям выбранной цели.</p>
          )}
        </li>

        <li className="cq-journey-stage cq-journey-next">
          <span className="cq-stage-marker" aria-hidden="true"><ArrowUpRight size={17} /></span>
          <span className="cq-stage-label">СЛЕДУЮЩИЙ ШАГ</span>
          <h3>{readOnly ? "Варианты для сотрудника" : "Ваш выбор"}</h3>
          {currentRecommendations?.recommendations.length ? (
            <>

              <ul className="cq-next-options">
                {currentRecommendations.recommendations.map((card) => (
                  <li key={card.candidate_id}>
                    <button type="button" onClick={() => onSelect(card)}>
                      <span>{card.title}</span><ArrowUpRight size={15} aria-hidden="true" />
                    </button>
                    {card.relevance === "prerequisite" ? (
                      <details className="compact-details"><summary>Подготовительный шаг</summary><p>{card.unlocks_event_ids.length ? `Откроет: ${card.unlocks_event_ids.map((id) => eventNames[id] ?? id).join(", ")}. ` : ""}Доступ зависит от условий участия.</p></details>
                    ) : card.goal_coverage_delta > 0 ? (
                      <p>+{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(card.goal_coverage_delta * 100)} п. п. к цели</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{!target ? readOnly ? "Сотрудник пока не выбрал цель." : "Сначала выберите цель." : currentRecommendations?.mode === "no_candidates" ? emptyReasons[currentRecommendations.empty_reason] : "Подборка появится после обновления рекомендаций."}</p>
          )}
        </li>

        <li className="cq-journey-stage cq-journey-target">
          <span className="cq-stage-marker" aria-hidden="true"><Flag size={17} /></span>
          <span className="cq-stage-label">ЦЕЛЬ</span>
          <h3>{target?.target_grade ?? (readOnly ? "Направление сотрудника" : "Ваше направление")}</h3>
          <p className="cq-stage-role">{target?.target_role ?? "Роль и грейд пока не выбраны"}</p>
          {target && <p className="cq-target-note">Соответствие роли ≠ повышение.</p>}
        </li>
      </ol>

      {employee.progress && (
        <details className="cq-progress-explanation">
          <summary>Как считается прогресс</summary>
          <p>Складываем {readOnly ? "уровни сотрудника" : "ваши уровни"} по навыкам цели, каждый — не выше требуемого, и делим на сумму требований. Приросты разных вариантов следующего шага не складываются: после выбора рекомендации пересчитываются.</p>
        </details>
      )}
    </section>
  );
}
