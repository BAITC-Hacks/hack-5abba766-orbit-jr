import type { DateOnly, EventView, Id, ParticipationSource } from '../types';

export type HistoryOutcome = 'completed' | 'declined' | 'no_show' | 'dropped';

export type HistoryEvidenceRecord = {
  record_id: Id;
  event_id: Id;
  date: DateOnly;
  status: HistoryOutcome;
  format: EventView['format'];
  shared_skill_ids: Id[];
};

export type HistoryEvidenceGroup = {
  /** All qualifying terminal source records in the date window, before truncation. */
  total_in_window: number;
  /** Denominator for counts; at most sample_limit, never the number of employees. */
  sample_size: number;
  counts: Record<HistoryOutcome, number>;
  evidence_ids: Id[];
  latest_records: HistoryEvidenceRecord[];
  /** Observed means enough descriptive evidence, not confidence in a prediction. */
  confidence: 'unknown' | 'observed';
};

export type HistoryEvidenceSummary = {
  as_of_date: DateOnly;
  window_start: DateOnly;
  sample_limit: number;
  minimum_sample: number;
  exact_event: HistoryEvidenceGroup;
  similar_same_format: HistoryEvidenceGroup;
  similar_other_format: HistoryEvidenceGroup;
};

const SAMPLE_LIMIT = 6;
const MINIMUM_SAMPLE = 3;
const OUTCOMES: ReadonlySet<string> = new Set(['completed', 'declined', 'no_show', 'dropped']);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function oneYearBefore(date: DateOnly): DateOnly {
  // The caller supplies a validated DateOnly. Clamp leap day to the prior year's
  // February end instead of rolling into March, and avoid the host timezone.
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year! - 1, month!, 0)).getUTCDate();
  return `${String(year! - 1).padStart(4, '0')}-${String(month!).padStart(2, '0')}-${String(Math.min(day!, lastDay)).padStart(2, '0')}`;
}

function summarizeGroup(records: HistoryEvidenceRecord[]): HistoryEvidenceGroup {
  const latest = [...records].sort((a, b) => compare(b.date, a.date)
    || compare(b.record_id, a.record_id) || compare(b.event_id, a.event_id)).slice(0, SAMPLE_LIMIT);
  const counts: HistoryEvidenceGroup['counts'] = { completed: 0, declined: 0, no_show: 0, dropped: 0 };
  for (const record of latest) counts[record.status]++;
  return {
    total_in_window: records.length,
    sample_size: latest.length,
    counts,
    evidence_ids: latest.map(record => record.record_id),
    latest_records: latest,
    confidence: latest.length < MINIMUM_SAMPLE ? 'unknown' : 'observed',
  };
}

/**
 * Descriptive source evidence for one candidate, scoped to one employee. Similar
 * means a different voluntary event with at least one shared developed skill.
 * Each of the three disjoint groups keeps its latest six terminal observations
 * in the inclusive prior-calendar-year window. Current audience restrictions
 * are not reapplied to historical enrollments, which may predate a promotion.
 * No completion overlays, inferred preferences, identities or assessment scores
 * enter this summary. For self-paced records date remains the source enrollment
 * date; the dataset does not supply a separate completion timestamp.
 */
export function summarizeHistoryEvidence(context: {
  employeeId: Id;
  asOfDate: DateOnly;
  event: EventView;
  events: readonly EventView[];
  history: readonly ParticipationSource[];
}): HistoryEvidenceSummary {
  const windowStart = oneYearBefore(context.asOfDate);
  const catalog = new Map(context.events.map(event => [event.event_id, event]));
  const candidateSkills = new Set(context.event.develops_skills.map(effect => effect.skill_id));
  const exact: HistoryEvidenceRecord[] = [];
  const sameFormat: HistoryEvidenceRecord[] = [];
  const otherFormat: HistoryEvidenceRecord[] = [];

  for (const row of context.history) {
    if (context.event.mandatory || row.employee_id !== context.employeeId
      || row.date < windowStart || row.date > context.asOfDate || !OUTCOMES.has(row.status)) continue;
    const event = catalog.get(row.event_id);
    if (!event || event.mandatory) continue;
    const sharedSkills = [...new Set(event.develops_skills.map(effect => effect.skill_id)
      .filter(skill => candidateSkills.has(skill)))].sort(compare);
    const isExact = event.event_id === context.event.event_id;
    if (!isExact && !sharedSkills.length) continue;
    const record: HistoryEvidenceRecord = {
      record_id: row.record_id, event_id: row.event_id, date: row.date,
      status: row.status as HistoryOutcome, format: event.format, shared_skill_ids: sharedSkills,
    };
    if (isExact) exact.push(record);
    else if (event.format === context.event.format) sameFormat.push(record);
    else otherFormat.push(record);
  }

  return {
    as_of_date: context.asOfDate, window_start: windowStart,
    sample_limit: SAMPLE_LIMIT, minimum_sample: MINIMUM_SAMPLE,
    exact_event: summarizeGroup(exact), similar_same_format: summarizeGroup(sameFormat),
    similar_other_format: summarizeGroup(otherFormat),
  };
}

const STATUS_LABELS: Record<HistoryOutcome, string> = {
  completed: 'завершено', declined: 'отказ', no_show: 'неявка', dropped: 'прекращено',
};

function groupText(label: string, group: HistoryEvidenceGroup): string {
  if (!group.sample_size) return `${label}: нет итоговых записей.`;
  const counts = Object.entries(group.counts).map(([status, count]) => `${STATUS_LABELS[status as HistoryOutcome]} ${count}/${group.sample_size}`).join(', ');
  return `${label}: ${counts}${group.total_in_window > group.sample_size ? ` (последние ${group.sample_size} из ${group.total_in_window} записей)` : ''}.`;
}

/** Concise card copy; record/event identifiers remain in the structured summary. */
export function historyEvidenceText(summary: HistoryEvidenceSummary): string {
  const insufficient = [summary.exact_event, summary.similar_same_format, summary.similar_other_format]
    .some(group => group.confidence === 'unknown');
  return [
    `За ${summary.window_start}–${summary.as_of_date}, до ${summary.sample_limit} последних итоговых записей на группу.`,
    groupText('Эта активность', summary.exact_event),
    'Похожие активности имеют общие развиваемые навыки.',
    groupText('Похожие, тот же формат', summary.similar_same_format),
    groupText('Похожие, другой формат', summary.similar_other_format),
    insufficient ? `В группах с менее ${summary.minimum_sample} записями данных недостаточно, вывод неизвестен.` : '',
    'Отсутствие записей не означает отказ. Причины исходов неизвестны: они не определяют мотивацию и не являются вероятностью будущего результата.',
    'Для самостоятельного обучения дата в источнике — дата зачисления.',
  ].filter(Boolean).join(' ');
}
