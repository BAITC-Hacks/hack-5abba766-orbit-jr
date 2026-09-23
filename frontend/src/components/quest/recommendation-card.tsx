import { ArrowUpRight } from "lucide-react";
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
}: {
  card: Card;
  employee: EmployeeView;
  names: Record<string, string>;
  select: () => void;
  eventNames?: Record<string, string>;
  actionLabel?: string;
}) {
  const explanationGroups: { label: string; categories: FactCategory[] }[] = [
    { label: "Почему подходит вам", categories: ["grade", "eligibility", "effort"] },
    { label: "Как приближает к цели", categories: ["skill_gap", "target_requirement"] },
    { label: "Что учтено из истории", categories: ["history"] },
  ];
  const citedFacts = card.facts.filter((fact) => card.reason_fact_ids.includes(fact.fact_id));
  return (
    <article className="course-card">
      <button
        className="course-art blue"
        onClick={select}
        aria-label={`Подробнее: ${card.title}`}
      >
        <span className="art-label">{eventTypes[card.event_type]}</span>
        <div className="sculpture blue" aria-hidden="true">
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
          {formats[card.format]} · {card.duration_hours} ч.
        </div>
        <h3>{card.title}</h3>
        <p>{activityDate(card.format, card.session_date)}</p>
        {card.relevance === "prerequisite" && (
          <p className="cq-preparation-note">
            Подготовительный шаг{card.unlocks_event_ids.length > 0 && <> к {card.unlocks_event_ids.map((id) => eventNames[id] ?? id).join(", ")}</>}.
            {" "}Доступ зависит от условий участия после завершения.
          </p>
        )}
        {card.expected_skill_changes.map((s) => (
          <p key={s.skill_id}>
            {names[s.skill_id] ?? s.skill_id}: {s.before} → {s.after} · цель{" "}
            {employee.skills.find((x) => x.skill_id === s.skill_id)
              ?.required_level ?? "—"}
          </p>
        ))}
        <div className="cq-recommendation-reasons">
          {explanationGroups.map((group) => {
            const facts = citedFacts.filter((fact) => group.categories.includes(fact.category));
            return facts.length > 0 ? <div key={group.label}>
              <h4>{group.label}</h4>
              <ul className="verified-facts">{facts.map((fact) => <li key={fact.fact_id}>{fact.text}</li>)}</ul>
            </div> : null;
          })}
        </div>
        <button className="text-button" onClick={select}>
          {actionLabel} →
        </button>
      </div>
    </article>
  );
}
