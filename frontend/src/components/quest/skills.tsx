"use client";
import { useState } from "react";
import type { EmployeeView, SkillView } from "../../../../contracts/backend";
export function Skills({
  employee,
  names,
}: {
  employee: EmployeeView;
  names: Record<string, string>;
}) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const filteringGaps = onlyGaps && !!employee.goal.target;
  const compare = (a: SkillView, b: SkillView) =>
    Number(b.critical) - Number(a.critical) ||
    (b.gap ?? 0) - (a.gap ?? 0) ||
    (names[a.skill_id] ?? a.skill_id).localeCompare(names[b.skill_id] ?? b.skill_id, "ru");
  const required = employee.skills.filter((skill) => (skill.required_level ?? 0) > 0);
  const gaps = required.filter((skill) => (skill.gap ?? 0) > 0).sort(compare);
  const covered = required.filter((skill) => skill.gap === 0).sort(compare);
  const other = employee.skills.filter((skill) => (skill.required_level ?? 0) <= 0)
    .sort((a, b) => b.current_level - a.current_level || compare(a, b));
  function rows(skills: SkillView[]) {
    return skills.map((skill) => (
      <div className="skill-row" key={skill.skill_id}>
        <div>
          <span>
            {names[skill.skill_id] ?? skill.skill_id}{" "}
            {skill.critical && <span className="critical">Критический</span>}
          </span>
          <b>{skill.current_level}<em> / {skill.required_level ?? "—"}</em></b>
        </div>
        <div className="skill-segments" aria-label={`Уровень ${skill.current_level}, требование ${skill.required_level ?? "нет"}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < skill.current_level ? "filled" : i < (skill.required_level ?? 0) ? "needed" : ""} />
          ))}
        </div>
        <small>
          {skill.gap !== null
            ? skill.gap === 0 ? "Требование цели выполнено" : `Оставшийся разрыв: ${skill.gap}`
            : employee.goal.target ? "Не входит в требования выбранной цели" : "Цель не выбрана"}
        </small>
      </div>
    ));
  }
  return (
    <section className="skills-panel">
      <div className="skills-intro">
        <h2>Навыки к цели</h2>
        <p>Сначала — навыки, которые приблизят вас к выбранной цели.</p>
        <small>Соответствие навыков не является гарантией повышения.</small>
        <button
          className="secondary skill-filter"
          aria-pressed={filteringGaps}
          disabled={!employee.goal.target}
          onClick={() => {
            setOnlyGaps((v) => !v);
          }}
        >
          {filteringGaps ? "Показать все навыки" : "Только навыки с разрывом"}
        </button>
      </div>
      <div className="skill-list">
        {employee.skills.length === 0 && <p>Нет данных о навыках.</p>}
        {gaps.length > 0 && <div className="cq-skill-group"><h3>Фокус развития <span>{gaps.length}</span></h3>{rows(gaps)}</div>}
        {employee.goal.target && gaps.length === 0 && <p className="cq-skills-covered" role="status">{filteringGaps ? "Нет оставшихся разрывов до цели." : "Все требования выбранной цели закрыты."}</p>}
        {!filteringGaps && covered.length > 0 && <div className="cq-skill-group cq-covered-skills"><h3>Уже соответствует цели <span>{covered.length}</span></h3>{rows(covered)}</div>}
        {!employee.goal.target && employee.skills.length > 0 && <p className="cq-skills-covered">Выберите цель, чтобы выделить навыки для развития.</p>}
        {!filteringGaps && other.length > 0 && <details className="cq-other-skills"><summary>{employee.goal.target ? "Остальные навыки" : "Все навыки профиля"}<span>{other.length}</span></summary>{rows(other)}</details>}
      </div>
    </section>
  );
}
