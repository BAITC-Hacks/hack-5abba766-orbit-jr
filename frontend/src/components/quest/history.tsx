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
}: {
  rows: ParticipationView[];
  busy: boolean;
  complete: (target: CompletionRequest["target"]) => void;
  moduleEventIds?: string[];
  learn?: (row: ParticipationView) => void;
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
          <h2 id="activity-title">Моя активность</h2>
          <p className="section-description">
            Продолжайте начатое и следите за своим прогрессом.
          </p>
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
      {!!rows.length && (
        <div className="history-filter">
          <label className="field-label">
            Статус участия
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Все статусы · {rows.length}</option>
              {Object.entries(statuses).map(([key, label]) => (
                <option key={key} value={key}>
                  {label} ·{" "}
                  {rows.filter((r) => r.effective_status === key).length}
                </option>
              ))}
            </select>
          </label>
          <p role="status">
            Показано: {visible.length} из {rows.length}
          </p>
        </div>
      )}
      {!rows.length && (
        <div className="empty-state">
          <BookOpen size={32} aria-hidden="true" />
          <h3>Здесь появится ваше обучение</h3>
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
                  ? "Дата демопрохождения"
                  : row.scheduled_session_date ? "Дата занятия" : "Дата записи"} ·{" "}
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
            {row.completion_origin === "simulation" && (
              <p className="activity-note">
                Результат демопрохождения · не подтверждает посещение
              </p>
            )}
            {row.superseded_by && (
              <p className="activity-note">
                Результат уже учтён в другом участии.
              </p>
            )}
            <div className="activity-card-footer">
              {row.actionable ? (
                <button
                  className="primary"
                  disabled={busy}
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
                    : "Отметить выполненной"}{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <span>
                  {row.effective_status === "completed"
                    ? "Участие завершено"
                    : "Нет доступных действий"}
                </span>
              )}
              <details className="activity-details">
                <summary>Детали участия</summary>
                <p>Запись: {row.participation_id}</p>
                {row.superseded_by && (
                  <p>Учтено участием: {row.superseded_by}</p>
                )}
              </details>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
