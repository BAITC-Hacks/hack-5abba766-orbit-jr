import type {
  CompletionRequest,
  ParticipationView,
} from "../../../../contracts/backend";
import { statuses } from "@/lib/labels";
export function History({
  rows,
  busy,
  complete,
  moduleEventIds = [],
  learn,
}: {
  rows: ParticipationView[];
  busy: boolean;
  complete: (target: CompletionRequest["target"]) => void;
  moduleEventIds?: string[];
  learn?: (row: ParticipationView) => void;
}) {
  return (
    <section className="history-panel">
      <h2>Ваш путь в деталях</h2>
      {!rows.length && <p>История участия пока пуста.</p>}
      {rows.map((row) => (
        <div className="history-row" key={row.participation_id}>
          <div>
            <h3>{row.event_title}</h3>
            <p>
              {statuses[row.effective_status]} · {row.completion_pct}%
            </p>
            <small>
              {row.completion_origin === "simulation" ? row.recorded_at?.slice(0, 10) : row.scheduled_session_date ?? row.source_date}
            </small>
            {row.completion_origin === "simulation" && (
              <p>Результат демопрохождения</p>
            )}
            {row.superseded_by && (
              <p>Результат этой активности уже учтён по другому завершению.</p>
            )}
          </div>
          {row.actionable && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => learn && moduleEventIds.includes(row.event_id) ? learn(row) : complete({
                  kind: "existing_participation",
                  participation_id: row.participation_id,
                })
              }
            >
              {learn && moduleEventIds.includes(row.event_id) ? "Продолжить уроки" : "Отметить выполненной"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
