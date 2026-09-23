import type { CatalogCoverageGapReason, HrCatalogCoverageGap } from '../../../../contracts/development-insights';

const reasons: Record<CatalogCoverageGapReason, { short: string; label: string; next: string }> = {
  NO_VOLUNTARY_CATALOG_COVERAGE: {
    short: 'Нет обучения',
    label: 'В каталоге нет добровольной активности по навыку',
    next: 'Рассмотрите новый курс, практику или менторство с явно указанным результатом по этому навыку.',
  },
  AUDIENCE_MISMATCH: {
    short: 'Другая аудитория',
    label: 'Активности рассчитаны на другую роль или грейд',
    next: 'Уточните условия участия или добавьте подготовительную программу для этой аудитории.',
  },
  LEVEL_CAP_REACHED: {
    short: 'Нужен следующий уровень',
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
      <article className="catalog-gap-card" key={`${gap.skill_id}:${gap.reason}`}>
        <span className="gap-reason">{reasons[gap.reason].short}</span>
        <h3>{names[gap.skill_id] ?? gap.skill_id}</h3>
        <dl className="gap-metrics">
          <div><dt>Сотрудников</dt><dd>{gap.employee_count}</dd></div>
          <div><dt>Критический навык</dt><dd>{gap.critical_employee_count}</dd></div>
        </dl>
        <details className="compact-details">
          <summary>Причина и решение</summary>
          <p><strong>{reasons[gap.reason].label}</strong></p>
          <p>Критический навык цели: <strong>{gap.critical_employee_count}</strong></p>
          <p>{reasons[gap.reason].next}</p>
          {!!gap.related_event_ids.length && <p>Активностей: {gap.related_event_ids.length} · По аудитории: {gap.audience_event_ids.length}</p>}
        </details>
        <details style={{ padding: '4px 0 0', borderBottom: 0 }}>
          <summary>Сотрудники ({gap.employee_count})</summary>
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
    <section className="people-panel catalog-gaps-panel" aria-label="Потребности в развитии каталога">
      <h2>Где расширить возможности развития</h2>

      {gaps.length === 0 ? (
        <p>В этой выборке пробелов по покрытию каталога не найдено.</p>
      ) : (
        <>
          <div className="catalog-gap-grid">{gaps.slice(0, 8).map(renderGap)}</div>
          {gaps.length > 8 && (
            <details style={{ padding: 0, borderBottom: 0 }}>
              <summary>Остальные потребности ({gaps.length - 8})</summary>
              <div className="catalog-gap-grid">
                {gaps.slice(8).map(renderGap)}
              </div>
            </details>
          )}
        </>
      )}
      <details className="compact-details"><summary>Как определяются потребности</summary><p>
        Наличие активности в каталоге означает потенциальную возможность развития.
        Предварительные требования, расписание, история прохождения и последовательность шагов
        проверяются отдельно при подборе рекомендаций. Отсутствие строк здесь не гарантирует готовый маршрут.
      </p></details>
    </section>
  );
}
