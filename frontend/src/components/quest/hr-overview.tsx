"use client";
import { GoalDonut } from "./growth-insights";
import { useState } from "react";
import { ArrowUpRight, Target, Users, Sparkles } from "lucide-react";
import type { HrOverview as Overview } from "../../../../contracts/backend";
import { emptyReasons, goalSources, statuses } from "@/lib/labels";
export function HrOverview({
  data,
  open,
  names = {},
  showPeople,
}: {
  data: Overview;
  open: (id: string) => void;
  names?: Record<string, string>;
  showPeople?: () => void;
}) {
  const [reason, setReason] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [allPeople, setAllPeople] = useState(false);
  const gaps = Object.values(
    data.skill_gaps.reduce<
      Record<
        string,
        { id: string; people: number; total: number; points: number }
      >
    >((acc, g) => {
      const item = acc[g.skill_id] ?? {
        id: g.skill_id,
        people: 0,
        total: 0,
        points: 0,
      };
      item.people += g.employees_with_gap;
      item.total += g.denominator;
      item.points += g.total_gap_points;
      acc[g.skill_id] = item;
      return acc;
    }, {}),
  ).sort((a, b) => b.people - a.people || b.points - a.points);
  const missing = data.goals_by_source.missing;
  const available = data.no_next_step.filter(
    (p) => reason === "all" || p.reason === reason,
  );
  return (
    <>
      <section className="hr-summary-cards" aria-label="Показатели команды">
        <div>
          <span className="metric-icon">
            <Users size={21} aria-hidden="true" />
          </span>
          <p>Сотрудники</p>
          <strong>{data.employee_count}</strong>
          <button className="text-button" onClick={showPeople}>
            Перейти к команде <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
        <div>
          <span className="metric-icon">
            <Target size={21} aria-hidden="true" />
          </span>
          <p>Без карьерной цели</p>
          <strong>{missing}</strong>
          <span>Помогите выбрать направление развития</span>
        </div>
        <div>
          <span className="metric-icon">
            <Sparkles size={21} aria-hidden="true" />
          </span>
          <p>Смоделировано завершений</p>
          <strong>{data.participation.simulated_completions}</strong>
          <span>Сценарии развития, без подтверждения посещения</span>
        </div>
      </section>
      <div className="hr-overview-grid">
        <section className="hr-surface">
          <span className="eyebrow">ПЛАНИРОВАНИЕ ОБУЧЕНИЯ</span>
          <h2>Какие навыки развивать</h2>
          <p className="section-description">
            Навыки, которых не хватает до карьерных целей. Сначала — те, где
            разрыв есть у большего числа людей.
          </p>
          <div className="gap-list">
            {gaps.slice(0, expanded ? undefined : 5).map((g) => (
              <div className="gap-item" key={g.id}>
                <div>
                  <strong>{names[g.id] ?? g.id}</strong>
                  <span>
                    {g.people} из {g.total} чел.
                  </span>
                </div>
                <progress
                  max={g.total || 1}
                  value={g.people}
                  aria-label={"Сотрудники с разрывом: " + (names[g.id] ?? g.id)}
                />
                <small>Из сотрудников, которым этот навык нужен для цели</small>
              </div>
            ))}
          </div>
          {!gaps.length && (
            <p className="empty-state">Разрывов в навыках пока нет.</p>
          )}
          {gaps.length > 5 && (
            <button
              className="text-button"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Свернуть" : "Все навыки (" + gaps.length + ")"}
            </button>
          )}
          {!!gaps.length && (
            <details className="analytics-details">
              <summary>Детализация по источникам целей</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Навык</th>
                      <th>Источник цели</th>
                      <th>С разрывом / выборка</th>
                      <th>Сумма разрывов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.skill_gaps.map((g) => (
                      <tr key={g.skill_id + "-" + g.goal_source}>
                        <td>{names[g.skill_id] ?? g.skill_id}</td>
                        <td>{goalSources[g.goal_source]}</td>
                        <td>
                          {g.employees_with_gap} / {g.denominator}
                        </td>
                        <td>{g.total_gap_points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
        <section className="hr-surface">
          <span className="eyebrow">НАПРАВЛЕНИЯ РОСТА</span>
          <h2>Карьерные цели</h2>
          <p className="section-description">
            Откуда взялась цель каждого сотрудника.
          </p>
          <GoalDonut data={data} />
          <div className="hr-tip">
            <Target size={22} aria-hidden="true" />
            <p>
              Откройте профиль сотрудника, чтобы уточнить цель и посмотреть
              подходящие активности.
            </p>
          </div>
        </section>
      </div>
      <section className="hr-surface">
        <div className="section-heading">
          <div>
            <span className="eyebrow">РАБОТА С ТРАЕКТОРИЯМИ</span>
            <h2>Сотрудники без рекомендации</h2>
            <p className="section-description">
              Причины разные: от отсутствия цели до её достижения. Откройте
              профиль, чтобы разобраться.
            </p>
          </div>
          <span className="count-badge">{data.no_next_step.length} чел.</span>
        </div>
        {!!data.no_next_step.length && (
          <label className="field-label reason-filter">
            Причина
            <select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setAllPeople(false);
              }}
            >
              <option value="all">Все причины</option>
              {Object.entries(emptyReasons).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="attention-list">
          {available.slice(0, allPeople ? undefined : 8).map((p) => (
            <button
              className="attention-row"
              key={p.employee_id}
              onClick={() => open(p.employee_id)}
            >
              <span>
                <strong>{p.full_name}</strong>
                <small>{goalSources[p.goal_source]}</small>
              </span>
              <span>{emptyReasons[p.reason]}</span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </button>
          ))}
        </div>
        {available.length > 8 && (
          <button
            className="secondary attention-expand"
            onClick={() => setAllPeople((v) => !v)}
          >
            {allPeople
              ? "Показать меньше"
              : `Показать всех · ${available.length}`}
          </button>
        )}
        {!available.length && (
          <p className="empty-state">
            {data.no_next_step.length
              ? "Сотрудников с этой причиной нет."
              : data.employee_count
                ? "Для всех сотрудников доступен следующий шаг."
                : "В команде пока нет сотрудников. Добавьте их через импорт."}
          </p>
        )}
      </section>
      <section className="hr-surface">
        <span className="eyebrow">ИСТОРИЯ ОБУЧЕНИЯ</span>
        <h2>Участие в активностях</h2>
        <p className="section-description">
          Исходная история показана отдельно от моделирования. Числа относятся к
          участиям, а не к уникальным сотрудникам.
        </p>
        <div className="participation-grid">
          {Object.entries(statuses).map(([key, label]) => (
            <div key={key}>
              <span className={"status-badge " + key}>{label}</span>
              <strong>
                {
                  data.participation.actual_by_status[
                    key as keyof typeof statuses
                  ]
                }
              </strong>
              <small>в исходной истории</small>
            </div>
          ))}
        </div>
        <details className="analytics-details">
          <summary>Сравнить с результатами симуляций</summary>
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
                {Object.entries(statuses).map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      {
                        data.participation.actual_by_status[
                          key as keyof typeof statuses
                        ]
                      }
                    </td>
                    <td>
                      {
                        data.participation.effective_by_status[
                          key as keyof typeof statuses
                        ]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Попыток, перекрытых другим завершением:{" "}
            {data.participation.superseded_attempts}.
          </p>
        </details>
        <details className="analytics-details">
          <summary>Статистика по каждой активности</summary>
          {data.participation.by_activity.map((a) => (
            <details className="activity-breakdown" key={a.event_id}>
              <summary>{a.title}</summary>
              <p>
                Симуляций: {a.simulated_completions}; перекрытых попыток:{" "}
                {a.superseded_attempts}
              </p>
              {Object.entries(statuses).map(([key, label]) => (
                <p key={key}>
                  {label}: исходных{" "}
                  {a.actual_by_status[key as keyof typeof statuses]}, с учётом
                  симуляций{" "}
                  {a.effective_by_status[key as keyof typeof statuses]}
                </p>
              ))}
            </details>
          ))}
        </details>
      </section>
    </>
  );
}
