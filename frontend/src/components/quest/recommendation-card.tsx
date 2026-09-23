import { ArrowUpRight, Clock3 } from "lucide-react";
import { ActivityArt } from "./visuals";
import type {
  EmployeeView,
  FactCategory,
  RecommendationCard as Card,
} from "../../../../contracts/backend";
import { eventTypes, formats, activityDate } from "@/lib/labels";

export function RecommendationCard({
  card,
  employee,
  names,
  select,
  eventNames = {},
  actionLabel = "Подробнее",
  readOnly = false,
}: {
  card: Card;
  employee: EmployeeView;
  names: Record<string, string>;
  select: () => void;
  eventNames?: Record<string, string>;
  actionLabel?: string;
  readOnly?: boolean;
}) {
  const explanationGroups: { label: string; categories: FactCategory[] }[] = [
    { label: readOnly ? "Почему подходит сотруднику" : "Почему подходит вам", categories: ["grade", "eligibility", "effort"] },
    { label: "Как приближает к цели", categories: ["skill_gap", "target_requirement"] },
    { label: "Что учтено из истории", categories: ["history"] },
  ];
  const citedFacts = card.facts.filter((fact) => card.reason_fact_ids.includes(fact.fact_id));
  return (
    <article className="course-card learning-row visual-recommendation">
      <div className="recommendation-art">
        <ActivityArt type={card.event_type} compact />
        <span className="recommendation-rank">{String(card.rank).padStart(2, "0")}</span>
      </div>
      <div className="course-body learning-row-body">
        <div className="course-meta">
          {eventTypes[card.event_type]} · {formats[card.format]}
        </div>
        <h3>{card.title}</h3>
        <p>{activityDate(card.format, card.session_date)}</p>
        <div className="recommendation-impact">
          <span><Clock3 size={14} aria-hidden="true" />{card.duration_hours} ч.</span>
          {card.goal_coverage_delta > 0 && <span className="impact-gain"><ArrowUpRight size={14} aria-hidden="true" />+{Number((card.goal_coverage_delta * 100).toFixed(1))} п.п. к цели</span>}
          {card.relevance === "prerequisite" && <span>Подготовительный шаг</span>}
        </div>
        <details className="recommendation-reasons">
          <summary>Что даст обучение</summary>
          {card.relevance === "prerequisite" && (
            <p>
              Подготовка к: {card.unlocks_event_ids.map(id => eventNames[id] ?? id).join(", ")}. Доступ зависит от условий участия после завершения.
            </p>
          )}
          {!!card.expected_skill_changes.length && (
            <ul className="verified-facts">
              {card.expected_skill_changes.map((s) => (
                <li key={s.skill_id}>
                  {names[s.skill_id] ?? s.skill_id}: {s.before} → {s.after} · цель{" "}
                  {employee.skills.find((x) => x.skill_id === s.skill_id)?.required_level ?? "—"}
                </li>
              ))}
            </ul>
          )}
          {explanationGroups.map(group => {
            const facts = citedFacts.filter(fact => group.categories.includes(fact.category));
            return facts.length ? <div key={group.label}><h4>{group.label}</h4><ul className="verified-facts">{facts.map(fact => <li key={fact.fact_id}>{fact.text}</li>)}</ul></div> : null;
          })}
        </details>
      </div>
      <button className="text-button learning-row-action" onClick={select}>
        {actionLabel} <ArrowUpRight size={17} aria-hidden="true" />
      </button>
    </article>
  );
}
