import { ArrowUpRight, Clock3 } from "lucide-react";
import { ActivityArt } from "./visuals";
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
              Подготовительный шаг. Открывает доступ: {card.unlocks_event_ids.join(", ")}
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
          {!!card.facts.filter((f) => card.reason_fact_ids.includes(f.fact_id)).length && (
            <>
              <p>Почему вам подходит</p>
              <ul className="verified-facts">
                {card.facts
                  .filter((f) => card.reason_fact_ids.includes(f.fact_id))
                  .map((f) => (
                    <li key={f.fact_id}>{f.text}</li>
                  ))}
              </ul>
            </>
          )}
        </details>
      </div>
      <button className="text-button learning-row-action" onClick={select}>
        {card.action === "continue" ? "Продолжить" : "Подробнее"} <ArrowUpRight size={17} aria-hidden="true" />
      </button>
    </article>
  );
}
