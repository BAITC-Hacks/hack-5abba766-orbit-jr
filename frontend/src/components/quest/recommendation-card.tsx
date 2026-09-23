import { ArrowUpRight } from "lucide-react";
import type {
  EmployeeView,
  RecommendationCard as Card,
} from "../../../../contracts/backend";
import { eventTypes, formats, activityDate } from "@/lib/labels";
export function RecommendationCard({
  card,
  employee,
  names,
  select,
}: {
  card: Card;
  employee: EmployeeView;
  names: Record<string, string>;
  select: () => void;
}) {
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
          <p>
            Подготовительный шаг. Открывает доступ:{" "}
            {card.unlocks_event_ids.join(", ")}
          </p>
        )}
        {card.expected_skill_changes.map((s) => (
          <p key={s.skill_id}>
            {names[s.skill_id] ?? s.skill_id}: {s.before} → {s.after} · цель{" "}
            {employee.skills.find((x) => x.skill_id === s.skill_id)
              ?.required_level ?? "—"}
          </p>
        ))}
        <ul className="verified-facts">
          {card.facts
            .filter((f) => card.reason_fact_ids.includes(f.fact_id))
            .map((f) => (
              <li key={f.fact_id}>{f.text}</li>
            ))}
        </ul>
        <button className="text-button" onClick={select}>
          {card.action === "continue" ? "Продолжить" : "Начать"} →
        </button>
      </div>
    </article>
  );
}
