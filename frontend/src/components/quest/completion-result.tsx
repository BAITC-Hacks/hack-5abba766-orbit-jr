import { ArrowRight, Check, X } from "lucide-react";
import type { CompletionResult, GoalProgress } from "../../../../contracts/backend";

export function CompletionResultPanel({
  result,
  previousProgress,
  names,
  onClose,
}: {
  result: CompletionResult;
  previousProgress: GoalProgress | null;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const afterProgress = result.employee.progress;
  const percentage = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value * 100);
  const delta = previousProgress && afterProgress
    ? afterProgress.coverage - previousProgress.coverage
    : null;

  return (
    <section className="cq-completion" aria-label="Результат завершения активности">
      <div className="cq-completion-heading">
        <span className="cq-completion-check" aria-hidden="true"><Check size={22} /></span>
        <div>
          <span className="cq-kicker">ДЕМО-ПРОГРЕСС СОХРАНЁН</span>
          <h2>Ваши навыки обновились.</h2>
        </div>
        <button type="button" className="cq-close" onClick={onClose} aria-label="Закрыть результат завершения"><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="cq-completion-body">
        <ul className="cq-completion-skills" aria-label="Изменения навыков">
          {result.skill_changes.map((change) => (
            <li key={change.skill_id}>
              <span>{names[change.skill_id] ?? change.skill_id}</span>
              <span className="cq-skill-change"><span className="cq-sr-only">Было </span>{change.before}<ArrowRight size={16} aria-hidden="true" /><span className="cq-sr-only"> стало </span><strong>{change.after}</strong><em>+{change.gain}</em></span>
            </li>
          ))}
        </ul>
        {afterProgress ? (
          <div className="cq-completion-progress">
            <span>Соответствие карьерной цели</span>
            <div>
              {previousProgress && <><span className="cq-progress-before">{percentage(previousProgress.coverage)}%</span><ArrowRight size={21} aria-hidden="true" /><span className="cq-sr-only"> стало </span></>}
              <strong>{percentage(afterProgress.coverage)}%</strong>
            </div>
            {delta !== null && <p>{delta > 0 ? `+${percentage(delta)} п. п. к цели` : delta === 0 ? "Навыки выросли; покрытие требований цели не изменилось." : `${percentage(delta)} п. п. к цели`}</p>}
            <p className="cq-inline-note">{result.employee.goal.target?.target_grade} {result.employee.goal.target?.target_role}</p>
          </div>
        ) : (
          <p className="cq-completion-no-goal">Выберите карьерную цель, чтобы увидеть, как новые навыки приближают вас к ней.</p>
        )}
      </div>
      <p className="cq-completion-footnote">Сохранённый результат этого демо-завершения. Он показывает изменения навыков в сценарии и не подтверждает прохождение внешнего курса.</p>
    </section>
  );
}
