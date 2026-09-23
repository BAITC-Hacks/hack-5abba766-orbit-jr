import type { CatalogCoverageGapReason, HrCatalogCoverageGap } from '../../../../contracts/development-insights';

const reasons: Record<CatalogCoverageGapReason, { label: string; next: string }> = {
  NO_VOLUNTARY_CATALOG_COVERAGE: {
    label: 'В каталоге нет добровольной активности по навыку',
    next: 'Рассмотрите новый курс, практику или менторство с явно указанным результатом по этому навыку.',
  },
  AUDIENCE_MISMATCH: {
    label: 'Активности рассчитаны на другую роль или грейд',
    next: 'Уточните условия участия или добавьте подготовительную программу для этой аудитории.',
  },
  LEVEL_CAP_REACHED: {
    label: 'Уровень сотрудников достиг предела доступных по аудитории активностей',
    next: 'Нужна активность более высокого уровня: проверьте предел развития навыка в каталоге.',
  },
};

export function CatalogGaps({ gaps, names, open }: {
  gaps: HrCatalogCoverageGap[];
  names: Record<string, string>;
  open: (employeeId: string) => void;
}) {
  function renderGap(gap: HrCatalogCoverageGap) {
    return (
      <article className="panel" key={`${gap.skill_id}:${gap.reason}`} style={{ display: 'grid', gap: 10 }}>
        <h3>{names[gap.skill_id] ?? gap.skill_id}</h3>
        <p><strong>{reasons[gap.reason].label}</strong></p>
        <p>
          Сотрудников с потребностью: <strong>{gap.employee_count}</strong>
          {' · '}Критический навык цели: <strong>{gap.critical_employee_count}</strong>
        </p>
        <p>{reasons[gap.reason].next}</p>
        {gap.related_event_ids.length > 0 && (
          <p className="fine-print" style={{ margin: 0 }}>
            Активностей по навыку: {gap.related_event_ids.length}.
            {' '}Из них соответствуют аудитории хотя бы одного сотрудника этой группы:
            {' '}{gap.audience_event_ids.length}.
          </p>
        )}
        <details style={{ padding: '4px 0 0', borderBottom: 0 }}>
          <summary>Открыть профили сотрудников ({gap.employee_count})</summary>
          <ul style={{ display: 'grid', gap: 8, margin: '12px 0 0', paddingLeft: 20 }}>
            {gap.employee_ids.map(employeeId => (
              <li key={employeeId}>
                <button type="button" className="text-button" onClick={() => open(employeeId)}>
                  Профиль {employeeId}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </article>
    );
  }
  return (
    <section className="people-panel" aria-label="Потребности в развитии каталога" style={{ display: 'grid', gap: 20, lineHeight: 1.6 }}>
      <h2>Где расширить возможности развития</h2>
      <p>
        Навыки карьерных целей, для которых каталог не даёт прироста с учётом текущего уровня,
        роли и грейда. Это ориентир для развития программы обучения.
      </p>
      {gaps.length === 0 ? (
        <p>В этой выборке пробелов по покрытию каталога не найдено.</p>
      ) : (
        <>
          {gaps.slice(0, 8).map(renderGap)}
          {gaps.length > 8 && (
            <details style={{ padding: 0, borderBottom: 0 }}>
              <summary>Остальные потребности ({gaps.length - 8})</summary>
              <div style={{ display: 'grid', gap: 20, marginTop: 16 }}>
                {gaps.slice(8).map(renderGap)}
              </div>
            </details>
          )}
        </>
      )}
      <p className="fine-print" style={{ margin: 0 }}>
        Наличие активности в каталоге означает потенциальную возможность развития.
        Предварительные требования, расписание, история прохождения и последовательность шагов
        проверяются отдельно при подборе рекомендаций. Отсутствие строк здесь не гарантирует готовый маршрут.
      </p>
    </section>
  );
}
