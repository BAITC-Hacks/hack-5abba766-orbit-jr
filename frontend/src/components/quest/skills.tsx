import type { EmployeeView } from "../../../../contracts/backend";
export function Skills({
  employee,
  names,
}: {
  employee: EmployeeView;
  names: Record<string, string>;
}) {
  return (
    <section className="skills-panel">
      <div className="skills-intro">
        <span className="eyebrow">ВИДЕТЬ СВОЙ РОСТ</span>
        <h2>
          Ваш опыт.
          <br />В новой перспективе.
        </h2>
        <p>Текущий уровень и требования цели по расчёту сервера.</p>
        <small>Соответствие навыков не является гарантией повышения.</small>
      </div>
      <div className="skill-list">
        {employee.skills.length === 0 && <p>Нет данных о навыках.</p>}
        {employee.skills.map((s) => (
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
            <small>Оставшийся разрыв: {s.gap ?? "цель не выбрана"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
