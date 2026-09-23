"use client";
import { useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ArrowRight,
} from "lucide-react";
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
  readOnly = false,
}: {
  rows: ParticipationView[];
  busy: boolean;
  complete: (target: CompletionRequest["target"]) => void;
  moduleEventIds?: string[];
  learn?: (row: ParticipationView) => void;
  readOnly?: boolean;
}) {
  const [status, setStatus] = useState("all");
  const visible = rows.filter(
    (row) => status === "all" || row.effective_status === status,
  );
  const counts = {
    completed: rows.filter((r) => r.effective_status === "completed").length,
    in_progress: rows.filter((r) => r.effective_status === "in_progress")
      .length,
    overdue: rows.filter((r) => r.effective_status === "overdue").length,
  };
  return (
    <section className="activity-section" aria-labelledby="activity-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ОБУЧЕНИЕ И РАЗВИТИЕ</span>
          <h2 id="activity-title">{readOnly ? "Активность сотрудника" : "Моя активность"}</h2>
        </div>
      </div>
      <div className="activity-stats" aria-label="Статистика участия">
        <div>
          <Clock3 size={20} aria-hidden="true" />
          <strong>{counts.in_progress}</strong>
          <span>в процессе</span>
        </div>
        <div>
          <CheckCircle2 size={20} aria-hidden="true" />
          <strong>{counts.completed}</strong>
          <span>завершено</span>
        </div>
        <div>
          <CalendarDays size={20} aria-hidden="true" />
          <strong>{counts.overdue}</strong>
          <span>просрочено</span>
        </div>
      </div>
      {!!rows.length && <div className="activity-distribution" role="img" aria-label={`Всего ${rows.length}: ${Object.entries(statuses).map(([key, label]) => `${label} ${rows.filter(row => row.effective_status === key).length}`).join(", ")}`}>
        {Object.keys(statuses).filter(key => rows.some(row => row.effective_status === key)).map(key => <span key={key} className={`distribution-${key}`} style={{ flexGrow: rows.filter(row => row.effective_status === key).length }} />)}
      </div>}
      {!!rows.length && (
        <div className="history-filter">
          <div className="activity-filter-chips" role="group" aria-label="Статус участия">
            {[["all", "Все"], ...Object.entries(statuses)].map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}<span>{key === "all" ? rows.length : rows.filter(row => row.effective_status === key).length}</span></button>)}
          </div>
          <span className="sr-only" role="status">Показано: {visible.length} из {rows.length}</span>
        </div>
      )}
      {!rows.length && (
        <div className="empty-state">
          <BookOpen size={32} aria-hidden="true" />
          <h3>{readOnly ? "У сотрудника пока нет истории обучения" : "Здесь появится ваше обучение"}</h3>
          <p>Подходящие активности можно посмотреть в разделе «Обзор».</p>
        </div>
      )}
      {!!rows.length && !visible.length && (
        <div className="empty-state">
          <h3>Пока нет активностей с таким статусом</h3>
          <button className="secondary" onClick={() => setStatus("all")}>
            Показать все активности
          </button>
        </div>
      )}
      <div className="activity-grid">
        {visible.map((row) => (
          <article
            className={"activity-card status-" + row.effective_status}
            key={row.participation_id}
          >
            <div className="activity-card-top">
              <span className="activity-icon" aria-hidden="true">
                {row.effective_status === "completed" ? (
                  <CheckCircle2 size={25} />
                ) : (
                  <BookOpen size={25} />
                )}
              </span>
              <span className={"status-badge " + row.effective_status}>
                {statuses[row.effective_status]}
              </span>
            </div>
            <h3>{row.event_title}</h3>
            <p className="activity-date">
              <CalendarDays size={16} aria-hidden="true" />
              <span>
                {row.completion_origin === "simulation"
                  ? "Демопрохождение"
                  : row.scheduled_session_date ? "Занятие" : "Запись"} ·{" "}
                {(row.completion_origin === "simulation"
                  ? row.recorded_at?.slice(0, 10)
                  : row.scheduled_session_date ?? row.source_date) ?? "Не указана"}
              </span>
            </p>
            <div className="activity-progress">
              <div>
                <span>Прогресс</span>
                <strong>{row.completion_pct}%</strong>
              </div>
              <progress
                max={100}
                value={row.completion_pct}
                aria-label={"Прогресс: " + row.event_title}
              />
            </div>
            <div className="compact-meta">
              {row.completion_origin === "simulation" && <span title="Не подтверждает посещение">Деморезультат</span>}
              {row.superseded_by && <span>Учтено в другом участии</span>}
            </div>
            <div className="activity-card-footer">
              {!readOnly && row.actionable ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  aria-label={`${learn && moduleEventIds.includes(row.event_id) ? "Продолжить уроки" : "Отметить выполненной"}: ${row.event_title}`}
                  onClick={() =>
                    learn && moduleEventIds.includes(row.event_id)
                      ? learn(row)
                      : complete({
                      kind: "existing_participation",
                      participation_id: row.participation_id,
                    })
                  }
                >
                  {learn && moduleEventIds.includes(row.event_id)
                    ? "Продолжить уроки"
                    : "Смоделировать выполнение"}{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : null}
              <details className="activity-details">
                <summary aria-label={`Детали: ${row.event_title}`}>Детали</summary>
                {row.completion_origin === "simulation" && <p>Деморезультат не подтверждает посещение.</p>}
                <p>Источник: {row.source_status ? "Загруженная история" : "Демонстрационный сценарий"}</p>
                {row.source_status && <p>Исходный статус: {statuses[row.source_status]}</p>}
                {row.applied_as_of && <p>Учтено в расчёте на {row.applied_as_of}</p>}
              </details>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
