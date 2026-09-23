import { ArrowUpRight, BriefcaseBusiness, Target } from "lucide-react";
import type { EmployeeView } from "../../../../contracts/backend";
import { goalSources } from "@/lib/labels";
import { Skills } from "./skills";

const workFormats = { office: "В офисе", hybrid: "Гибридный", remote: "Удалённо" };
const languages = { ru: "Русский", kk: "Қазақша", en: "English" };

export function EmployeeProfile({ employee: p, names, onGoal, disabled, readOnly = false }: {
  employee: EmployeeView;
  names: Record<string, string>;
  onGoal: () => void;
  disabled: boolean;
  readOnly?: boolean;
}) {
  const completed = p.history.filter(row => row.effective_status === "completed").length;
  const active = p.history.filter(row => row.effective_status === "in_progress").length;
  const tenure = p.tenure_months < 12 ? `${p.tenure_months} мес.` : `${Math.floor(p.tenure_months / 12)} г. ${p.tenure_months % 12} мес.`;
  const reviewDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p.last_review_date}T00:00:00Z`));
  return <div className="employee-profile-page">
    <div className="profile-summary-grid">
      <section className="profile-info-card" aria-labelledby="profile-about">
        <div className="profile-card-heading"><BriefcaseBusiness size={20} aria-hidden="true" /><h2 id="profile-about">О сотруднике</h2></div>
        <dl className="profile-facts">
          {[["Подразделение", p.department], ["Должность", p.role], ["Грейд", p.grade], ["Стаж в компании", tenure], ["Формат работы", workFormats[p.work_format]], ["Язык обучения", languages[p.preferred_language]], ["Последняя оценка", reviewDate]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
      <section className="profile-goal-card" aria-labelledby="profile-goal">
        <div className="profile-card-heading"><Target size={20} aria-hidden="true" /><h2 id="profile-goal">Направление развития</h2></div>
        <span className="profile-goal-source">{goalSources[p.goal.source]}</span>
        <h3>{p.goal.target ? `${p.goal.target.target_grade} ${p.goal.target.target_role}` : "Следующий шаг начинается с цели"}</h3>
        <p>{p.goal.target ? "Навыки и обучение на пути к выбранной роли." : readOnly ? "Сотрудник пока не выбрал направление развития." : "Выберите роль, чтобы увидеть требования и подходящее обучение."}</p>
        {p.progress && <div className="profile-coverage"><div><span>Соответствие цели</span><strong>{Math.round(p.progress.coverage * 100)}%</strong></div><progress max={100} value={Math.round(p.progress.coverage * 100)} aria-label="Соответствие цели" /></div>}
        {!readOnly && <button className="secondary" onClick={onGoal} disabled={disabled}>{p.goal.target ? "Изменить цель" : "Выбрать цель"}<ArrowUpRight size={16} aria-hidden="true" /></button>}
      </section>
    </div>
    <dl className="profile-statistics" aria-label="Обучение и навыки">
      <div><dt>Навыков в профиле</dt><dd>{p.skills.length}</dd></div>
      <div><dt>Завершено активностей</dt><dd>{completed}</dd></div>
      <div><dt>В процессе обучения</dt><dd>{active}</dd></div>
    </dl>
    <Skills employee={p} names={names} readOnly={readOnly} />
  </div>;
}
