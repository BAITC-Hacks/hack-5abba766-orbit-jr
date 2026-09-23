import type { EmployeeView, EventView, SkillView } from "../../../../contracts/backend";

/** Catalog facts explain a possible effect; the server still checks every start. */
export function SkillCourseDetails({ event, skill, employee, names, asOfDate }: {
  event: EventView;
  skill: SkillView;
  employee: EmployeeView;
  names: Record<string, string>;
  asOfDate?: string;
}) {
  const effect = event.develops_skills.find(item => item.skill_id === skill.skill_id);
  if (!effect) return null;
  const after = skill.current_level + Math.max(0, Math.min(effect.gain, effect.max_level - skill.current_level, 5 - skill.current_level));
  const active = employee.history.some(row => row.event_id === event.event_id && row.actionable);
  const completed = !event.repeatable && employee.history.some(row => row.event_id === event.event_id && row.effective_status === "completed");
  const missing = Object.entries(event.prerequisites).filter(([id, level]) =>
    (employee.skills.find(item => item.skill_id === id)?.current_level ?? 0) < level);
  const otherAudience = !event.target_roles.includes(employee.role) || !event.target_grades.includes(employee.grade);
  return <div className="catalog-skill-details">
    <p className="catalog-skill-effect"><strong>{names[skill.skill_id] ?? skill.skill_id}</strong>{" "}
      {completed && !active ? "— уже пройдено; повторное выполнение не начислит навык."
        : after > skill.current_level ? <>— возможный рост <b>{skill.current_level} → {after}</b></>
          : "— эта программа уже не повысит навык."}
    </p>
    {(skill.gap ?? 0) > 0 && skill.required_level !== null && after > skill.current_level && !completed && <p>
      {after >= skill.required_level ? "При успешном выполнении закроет разрыв по этому навыку."
        : `До цели ${skill.required_level}: после этой программы останется ${skill.required_level - after}.`}
    </p>}
    {active ? <p>Обучение уже начато — его можно продолжить в активности.</p>
      : event.mandatory ? <p>Обязательная программа по назначению.</p>
        : otherAudience ? <p>Для другой роли или грейда: {event.target_roles.join(", ")} · {event.target_grades.join(", ")}.</p>
          : missing.length > 0 ? <p>Сначала нужны навыки: {missing.map(([id, level]) => `${names[id] ?? id} — ${level}`).join(", ")}.</p>
            : null}
    {!active && !completed && event.format !== "self_paced" && asOfDate &&
      !event.upcoming_sessions.some(date => date >= asOfDate) && <p>Будущих дат пока нет — начать эту программу сейчас нельзя.</p>}
    <details className="catalog-requirements"><summary>Условия участия</summary>
      <p>Роли: {event.target_roles.join(", ")}. Грейды: {event.target_grades.join(", ")}.</p>
      <p>{Object.keys(event.prerequisites).length
        ? `Предварительные навыки: ${Object.entries(event.prerequisites).map(([id, level]) => `${names[id] ?? id} — ${level}`).join(", ")}.`
        : "Предварительных требований к навыкам нет."}</p>
      <p>Предел развития навыка в программе: {effect.max_level} из 5.</p>
    </details>
  </div>;
}
