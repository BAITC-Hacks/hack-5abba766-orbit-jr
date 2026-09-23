import type { HrOverview as Overview } from "../../../../contracts/backend";
import { emptyReasons, goalSources, statuses } from "@/lib/labels";
export function HrOverview({
  data,
  open,
  names = {},
}: {
  data: Overview;
  open: (id: string) => void;
  names?: Record<string, string>;
}) {
  return (
    <>
      <section className="hr-metrics">
        <div>
          <strong>{data.employee_count}</strong>
          <p>сотрудников в доступной сводке</p>
        </div>
        <div>
          <strong>{data.no_next_step.length}</strong>
          <p>без доступного следующего шага</p>
        </div>
        <div>
          <strong>{data.participation.simulated_completions}</strong>
          <p>симуляций завершения · отдельно от фактической истории</p>
        </div>
      </section>
      <section className="panel">
        <h2>Источники карьерных целей</h2>
        {Object.entries(data.goals_by_source).map(([key, count]) => (
          <p key={key}>
            {goalSources[key as keyof typeof goalSources]}: {count}
          </p>
        ))}
      </section>
      <section className="people-panel">
        <h2>Разрывы до карьерной цели</h2>
        <p>
          Каждая доля относится к сотрудникам с указанным источником цели, для
          которых эта цель требует навык.
        </p>
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
                <tr key={`${g.skill_id}-${g.goal_source}`}>
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
        {!data.skill_gaps.length && <p>Разрывов в этой выборке нет.</p>}
      </section>
      <section className="people-panel">
        <h2>Нет следующего шага</h2>
        {data.no_next_step.map((p) => (
          <div className="history-row" key={p.employee_id}>
            <div>
              <button
                className="text-button"
                onClick={() => open(p.employee_id)}
              >
                {p.full_name}
              </button>
              <p>{goalSources[p.goal_source]}</p>
            </div>
            <p>{emptyReasons[p.reason]}</p>
          </div>
        ))}
        {!data.no_next_step.length && (
          <p>
            {data.employee_count
              ? "Для всех сотрудников доступен следующий шаг."
              : "В доступной выборке пока нет сотрудников."}
          </p>
        )}
      </section>
      <section className="people-panel">
        <h2>Участие в активностях</h2>
        <p>
          Исходные наблюдения и симуляции показаны отдельно. Это не рейтинг
          эффективности.
        </p>
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
              {Object.entries(statuses).map(([status, label]) => (
                <tr key={status}>
                  <td>{label}</td>
                  <td>
                    {
                      data.participation.actual_by_status[
                        status as keyof typeof statuses
                      ]
                    }
                  </td>
                  <td>
                    {
                      data.participation.effective_by_status[
                        status as keyof typeof statuses
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
        {data.participation.by_activity.map((a) => (
          <details key={a.event_id}>
            <summary>{a.title}</summary>
            <p>
              Симуляций: {a.simulated_completions}; перекрытых попыток:{" "}
              {a.superseded_attempts}
            </p>
            {Object.entries(statuses).map(([key, label]) => (
              <p key={key}>
                {label}: исходных{" "}
                {a.actual_by_status[key as keyof typeof statuses]}, с учётом
                симуляций {a.effective_by_status[key as keyof typeof statuses]}
              </p>
            ))}
          </details>
        ))}
      </section>
    </>
  );
}
