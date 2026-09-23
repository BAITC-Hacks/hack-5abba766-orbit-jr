import type { HrOverview } from "../../../../contracts/backend";
import { goalSources } from "@/lib/labels";

const colors = ["#74c9a7", "#b6a0e9", "#e3bf77", "#859bb7"];
export function GoalDonut({ data }: { data: HrOverview }) {
  const entries = Object.entries(data.goals_by_source);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  let offset = 0;
  return <figure className="goal-donut">
    <div className="donut-visual">
      <svg viewBox="0 0 160 160" role="img" aria-label={total ? `Карьерные цели: ${entries.map(([key, count]) => `${goalSources[key as keyof typeof goalSources]} — ${count}`).join(", ")}` : "Нет данных о карьерных целях"}>
        <circle className="donut-track" cx="80" cy="80" r="64" fill="none" strokeWidth="13" />
        {entries.map(([key, count], i) => {
          const length = total ? count / total * 100 : 0;
          const start = offset; offset += length;
          return <circle key={key} className="donut-segment" cx="80" cy="80" r="64" fill="none" stroke={colors[i % colors.length]} strokeWidth="13" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{`${goalSources[key as keyof typeof goalSources]}: ${count}`}</title></circle>;
        })}
      </svg>
      <div className="donut-center" aria-hidden="true"><strong>{total}</strong><span>{total ? "сотрудников" : "нет данных"}</span></div>
    </div>
    <figcaption>{entries.map(([key, count], i) => <div key={key}><i style={{ background: colors[i % colors.length] }} /><span>{goalSources[key as keyof typeof goalSources]}</span><strong>{count}</strong><small>{total ? Math.round(count / total * 100) : 0}%</small></div>)}</figcaption>
  </figure>;
}
