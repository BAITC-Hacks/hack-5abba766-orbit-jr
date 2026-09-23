"use client";
import { CatalogSelect } from "./catalog-select";
import { GoalDonut } from "./growth-insights";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, Target, Users, Sparkles, ListChecks, Upload, ChartNoAxesCombined } from "lucide-react";
import type { HrOverview as Overview } from "../../../../contracts/backend";
import { emptyReasons, goalSources, statuses } from "@/lib/labels";
import { CatalogGaps } from "./catalog-gaps";
const hrEmptyReasons = { ...emptyReasons, GOAL_REQUIRED: "Цель пока не выбрана." };
export function HrOverview({
  data,
  open,
  names = {},
  showPeople,
  showImport,
}: {
  data: Overview;
  open: (id: string) => void;
  names?: Record<string, string>;
  showPeople?: () => void;
  showImport?: () => void;
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
  ).filter((gap) => gap.people > 0).sort((a, b) => b.people - a.people || b.points - a.points);
  const missing = data.goals_by_source.missing;
  const withGoal = Math.max(0, data.employee_count - missing);
  const goalCoverage = data.employee_count ? Math.round(withGoal / data.employee_count * 100) : null;
  const available = data.no_next_step.filter(
    (p) => reason === "all" || p.reason === reason,
  );
  return (
    <>
      <section className="hr-command-hero" aria-labelledby="hr-command-title">
        <div className="hr-command-copy">
          <span className="eyebrow">ЛЮДИ. НАВЫКИ. РАЗВИТИЕ.</span>
          <h2 id="hr-command-title">Помогайте команде<br />двигаться вперёд</h2>
          <p>Карьерные цели, потребности в обучении и следующий шаг для каждого сотрудника — в одном рабочем пространстве.</p>
          <div className="hr-command-actions">
            {showPeople && <button className="primary" onClick={showPeople}>Открыть сотрудников <ArrowRight size={18} aria-hidden="true" /></button>}
            <a className="secondary" href="#hr-attention-section">Разобрать рекомендации <ArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="hr-goal-coverage">
          <Target size={24} aria-hidden="true" />
          <span>Сотрудники с целью</span>
          <strong>{goalCoverage === null ? "—" : `${goalCoverage}%`}</strong>
          <progress max={data.employee_count || 1} value={withGoal} aria-label="Доля сотрудников с карьерной целью" />
          <p>{data.employee_count ? `${withGoal} из ${data.employee_count} сотрудников` : "Данные появятся после импорта"}</p>
          <small>Включая автоматически определённые цели</small>
        </div>
      </section>
      <section className="hr-summary-cards" aria-label="Показатели команды">
        <div>
          <span className="metric-icon">
            <Users size={21} aria-hidden="true" />
          </span>
          <p>Сотрудники</p>
          <strong>{data.employee_count}</strong>
          {showPeople && <button className="text-button" onClick={showPeople}>
            Открыть список <ArrowUpRight size={15} aria-hidden="true" />
          </button>}
        </div>
        <div>
          <span className="metric-icon">
            <Target size={21} aria-hidden="true" />
          </span>
          <p>Без карьерной цели</p>
          <strong>{missing}</strong>
          <span>Цель помогает подобрать обучение</span>
        </div>
        <div>
          <span className="metric-icon"><ListChecks size={21} aria-hidden="true" /></span>
          <p>Без рекомендации</p>
          <strong>{data.no_next_step.length}</strong>
          <span>В том числе с достигнутой целью</span>
        </div>
        <div>
          <span className="metric-icon">
            <Sparkles size={21} aria-hidden="true" />
          </span>
          <p>Смоделировано завершений</p>
          <strong>{data.participation.simulated_completions}</strong>
          <span>Без подтверждения посещения</span>
        </div>
      </section>
      <nav className="hr-priority-strip" aria-label="Быстрые действия HR">
        <a className="hr-priority-card" href="#hr-attention-section">
          <span className="hr-priority-icon"><ListChecks size={20} aria-hidden="true" /></span>
          <span className="hr-priority-copy"><strong>Разобрать причины</strong><small>Почему нет следующего шага</small></span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
        <a className="hr-priority-card" href="#hr-skills-section">
          <span className="hr-priority-icon"><ChartNoAxesCombined size={20} aria-hidden="true" /></span>
          <span className="hr-priority-copy"><strong>Спланировать обучение</strong><small>Навыки с наибольшим спросом</small></span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
        {showImport && <button className="hr-priority-card" onClick={showImport}>
          <span className="hr-priority-icon"><Upload size={20} aria-hidden="true" /></span>
          <span className="hr-priority-copy"><strong>Обновить данные</strong><small>Импорт команды и истории</small></span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </button>}
      </nav>
      <div className="hr-overview-grid">
        <section className="hr-surface" id="hr-skills-section" tabIndex={-1}>
          <span className="eyebrow">ПЛАНИРОВАНИЕ ОБУЧЕНИЯ</span>
          <h2>Какие навыки развивать</h2>
          <p className="section-description">
            По числу сотрудников с разрывом до цели.
          </p>
          <div className="gap-list" id="hr-skill-gaps">
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

              </div>
            ))}
          </div>
          {!gaps.length && (
            <p className="empty-state">Разрывов в навыках пока нет.</p>
          )}
          {gaps.length > 5 && (
            <button
              className="text-button"
              aria-expanded={expanded}
              aria-controls="hr-skill-gaps"
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

          <GoalDonut data={data} />
          <div className="hr-tip">
            <Target size={22} aria-hidden="true" />
            <p>
Цель и обучение — в профиле сотрудника.
            </p>
          </div>
        </section>
      </div>
      <CatalogGaps gaps={data.catalog_gaps} names={names} open={open} />
      <section className="hr-surface" id="hr-attention-section" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">РАБОТА С ТРАЕКТОРИЯМИ</span>
            <h2>Сотрудники без рекомендации</h2>
            <p className="section-description">Откройте профиль, чтобы изучить цель и доступные варианты обучения.</p>
          </div>
          <span className="count-badge" role="status">{reason === "all" ? `${available.length} чел.` : `${available.length} из ${data.no_next_step.length} чел.`}</span>
        </div>
        {!!data.no_next_step.length && (
          <CatalogSelect label="Причина" value={reason} onChange={(value) => { setReason(value); setAllPeople(false); }}
            options={[["all", "Все причины"], ...Object.entries(hrEmptyReasons).filter(([key]) => key === reason || data.no_next_step.some((person) => person.reason === key))]} />
        )}
        <div className="attention-list" id="hr-attention-list">
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
              <span>{hrEmptyReasons[p.reason]}</span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </button>
          ))}
        </div>
        {available.length > 8 && (
          <button
            className="secondary attention-expand"
            aria-expanded={allPeople}
            aria-controls="hr-attention-list"
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
        {!available.length && reason !== "all" && (
          <button className="secondary" onClick={() => { setReason("all"); setAllPeople(false); }}>
            Показать все причины
          </button>
        )}
        {!data.employee_count && showImport && (
          <button className="secondary" onClick={showImport}>
            Перейти к импорту
          </button>
        )}
      </section>
      <section className="hr-surface">
        <span className="eyebrow">ИСТОРИЯ ОБУЧЕНИЯ</span>
        <h2>Участие в активностях</h2>
        <p className="section-description">
Количество участий · исходная история.
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
          {!data.participation.by_activity.length && (
            <p className="empty-state">История участия пока пуста. Данные появятся после импорта истории обучения.</p>
          )}
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
