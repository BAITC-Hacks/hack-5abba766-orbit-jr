"use client";
import { useState } from "react";
import type { EmployeeView } from "../../../../contracts/backend";
export function Skills({
  employee,
  names,
}: {
  employee: EmployeeView;
  names: Record<string, string>;
}) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rows = employee.skills
    .filter((s) => !onlyGaps || (s.gap ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(b.required_level !== null) - Number(a.required_level !== null) ||
        Number(b.critical) - Number(a.critical) ||
        (b.gap ?? 0) - (a.gap ?? 0) ||
        b.current_level - a.current_level,
    );
  return (
    <section className="skills-panel">
      <div className="skills-intro">
        <h2>Навыки к цели</h2>
        <p>Текущий уровень и требования выбранной роли.</p>
        <small>Соответствие навыков не является гарантией повышения.</small>
        <button
          className="secondary skill-filter"
          aria-pressed={onlyGaps}
          disabled={!employee.goal.target}
          onClick={() => {
            setOnlyGaps((v) => !v);
            setExpanded(false);
          }}
        >
          {onlyGaps ? "Показать все навыки" : "Только навыки с разрывом"}
        </button>
      </div>
      <div className="skill-list">
        {employee.skills.length === 0 && <p>Нет данных о навыках.</p>}
        {onlyGaps && !rows.length && (
          <p role="status">Нет оставшихся разрывов до цели.</p>
        )}
        {(expanded ? rows : rows.slice(0, 8)).map((s) => (
          <div className="skill-row" key={s.skill_id}>
            <div>
              <span>
                {names[s.skill_id] ?? s.skill_id}{" "}
                {s.critical && <span className="critical">Критический</span>}
              </span>
              <b>
                {s.current_level}
                <em> / {s.required_level ?? "—"}</em>
              </b>
            </div>
            <div
              className="skill-segments"
              aria-label={`Уровень ${s.current_level}, требование ${s.required_level ?? "нет"}`}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < s.current_level
                      ? "filled"
                      : i < (s.required_level ?? 0)
                        ? "needed"
                        : ""
                  }
                />
              ))}
            </div>
            <small>
              {s.gap !== null
                ? `Оставшийся разрыв: ${s.gap}`
                : employee.goal.target
                  ? "Не входит в требования выбранной цели"
                  : "Цель не выбрана"}
            </small>
          </div>
        ))}
        {rows.length > 8 && (
          <button
            className="secondary skills-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Свернуть список"
              : `Показать все навыки · ${rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
