import type {
  CompletionRequest,
  ParticipationView,
} from "../../../../contracts/backend";
import { statuses } from "@/lib/labels";
export function History({
  rows,
  busy,
  complete,
}: {
  rows: ParticipationView[];
  busy: boolean;
  complete: (target: CompletionRequest["target"]) => void;
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
              {row.scheduled_session_date ?? row.source_date} ·{" "}
              {row.participation_id}
            </small>
            {row.completion_origin === "simulation" && (
              <p>Симуляция, не подтверждение посещения</p>
            )}
            {row.superseded_by && (
              <p>Результат учтён другим участием: {row.superseded_by}</p>
            )}
          </div>
          {row.actionable && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                complete({
                  kind: "existing_participation",
                  participation_id: row.participation_id,
                })
              }
            >
              Симулировать завершение
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
