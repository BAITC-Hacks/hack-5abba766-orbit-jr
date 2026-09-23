import { describe, expect, it } from 'vitest';
import type { EventView, ParticipationSource } from '../src/types';
import { historyEvidenceText, summarizeHistoryEvidence } from '../src/domain/history-evidence';

const event = (id: string, extra: Partial<EventView> = {}): EventView => ({
  event_id: id, title: 'Private catalog title', description: 'Not evidence', type: 'course',
  format: 'online', duration_hours: 8, mandatory: false, target_roles: ['Analyst'],
  target_grades: ['Junior'], prerequisites: {}, upcoming_sessions: [], repeatable: false,
  develops_skills: [{ skill_id: 'skill:analysis', gain: 1, max_level: 4 }], ...extra,
});

const candidate = event('candidate/new');
const online = event('similar/online');
const selfPaced = event('similar/self-paced', { format: 'self_paced' });
const offline = event('similar/offline', { format: 'offline' });
const unrelated = event('unrelated', { develops_skills: [{ skill_id: 'skill:writing', gain: 1, max_level: 4 }] });
const mandatory = event('mandatory', { mandatory: true });
const events = [candidate, online, selfPaced, offline, unrelated, mandatory];

const row = (id: string, eventId: string, status: ParticipationSource['status'], date = '2026-09-01', extra: Partial<ParticipationSource> = {}): ParticipationSource => ({
  record_id: id, employee_id: 'private-employee-id', event_id: eventId, status, date,
  due_date: null, completion_pct: status === 'completed' ? 100 : 0,
  score: 91, feedback_rating: 4, assigned_by: 'manager', ...extra,
});

const summarize = (history: ParticipationSource[], asOfDate = '2026-10-01') => summarizeHistoryEvidence({
  employeeId: 'private-employee-id', asOfDate, event: candidate, events, history,
});

describe('source history evidence for similar activities', () => {
  it('separates exact event, similar event with the same format, and other formats without double counting', () => {
    const summary = summarize([
      row('exact', candidate.event_id, 'completed'),
      row('online-declined', online.event_id, 'declined'),
      row('online-no-show', online.event_id, 'no_show'),
      row('online-dropped', online.event_id, 'dropped'),
      row('self-completed', selfPaced.event_id, 'completed'),
      row('offline-completed', offline.event_id, 'completed'),
      row('unrelated-declined', unrelated.event_id, 'declined'),
    ]);
    expect(summary.exact_event.counts).toEqual({ completed: 1, declined: 0, no_show: 0, dropped: 0 });
    expect(summary.similar_same_format).toMatchObject({
      sample_size: 3, confidence: 'observed', counts: { completed: 0, declined: 1, no_show: 1, dropped: 1 },
    });
    expect(summary.similar_other_format).toMatchObject({ sample_size: 2, counts: { completed: 2 }, confidence: 'unknown' });
    expect(summary.similar_other_format.latest_records.map(record => record.format).sort()).toEqual(['offline', 'self_paced']);
    expect(summary.similar_same_format.latest_records.every(record => record.shared_skill_ids.join() === 'skill:analysis')).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('unrelated-declined');
  });

  it('scopes evidence by employee and inclusive scenario window; excludes mandatory, unknown and ongoing records', () => {
    const summary = summarize([
      row('start-boundary', online.event_id, 'completed', '2025-10-01'),
      row('end-boundary', online.event_id, 'no_show', '2026-10-01'),
      row('too-old', online.event_id, 'declined', '2025-09-30'),
      row('future', online.event_id, 'declined', '2026-10-02'),
      row('someone-else', online.event_id, 'declined', '2026-09-30', { employee_id: 'other-employee' }),
      row('mandatory', mandatory.event_id, 'completed'),
      row('unknown', 'unknown-event', 'completed'),
      row('ongoing', online.event_id, 'in_progress'),
      row('overdue', online.event_id, 'overdue'),
    ]);
    expect(summary.window_start).toBe('2025-10-01');
    expect(summary.similar_same_format.evidence_ids).toEqual(['end-boundary', 'start-boundary']);
    expect(summary.similar_same_format.sample_size).toBe(2);
    expect(summary.similar_same_format.confidence).toBe('unknown');
  });

  it('keeps the latest six per group, with counts and evidence IDs using the same denominator', () => {
    const history = Array.from({ length: 8 }, (_, index) => row(`record-${index}`, online.event_id,
      index < 2 ? 'declined' : 'completed', `2026-09-0${index + 1}`));
    const group = summarize(history).similar_same_format;
    expect(group).toMatchObject({ total_in_window: 8, sample_size: 6, counts: { completed: 6, declined: 0, no_show: 0, dropped: 0 } });
    expect(group.evidence_ids).toEqual(['record-7', 'record-6', 'record-5', 'record-4', 'record-3', 'record-2']);
    expect(Object.values(group.counts).reduce((sum, count) => sum + count, 0)).toBe(group.sample_size);
    expect(group.latest_records.map(record => record.record_id)).toEqual(group.evidence_ids);
  });

  it('has stable record-ID ordering when dates tie, regardless of input order, without mutating source data', () => {
    const history = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => row(id, online.event_id, id === 'A' ? 'declined' : 'completed'));
    const before = structuredClone(history);
    const first = summarize(history);
    expect(summarize([...history].reverse())).toEqual(first);
    expect(first.similar_same_format.evidence_ids).toEqual(['G', 'F', 'E', 'D', 'C', 'B']);
    expect(history).toEqual(before);
  });

  it('distinguishes missing history and one successful observation, while both remain insufficient for inference', () => {
    const empty = summarize([]);
    const successful = summarize([row('done', online.event_id, 'completed')]);
    expect(empty.similar_same_format).toMatchObject({ sample_size: 0, confidence: 'unknown', counts: { completed: 0, declined: 0 } });
    expect(successful.similar_same_format).toMatchObject({ sample_size: 1, confidence: 'unknown', counts: { completed: 1, declined: 0 } });
    expect(historyEvidenceText(empty)).toContain('нет итоговых записей');
    expect(historyEvidenceText(successful)).toContain('завершено 1/1');
    expect(historyEvidenceText(successful)).toContain('данных недостаточно, вывод неизвестен');
  });

  it('returns only traceable activity evidence, without employee identity, scores or catalog prose', () => {
    const summary = summarize([row('evidence-1', online.event_id, 'dropped')]);
    const serialized = JSON.stringify(summary);
    const text = historyEvidenceText(summary);
    for (const privateField of ['private-employee-id', 'employee_id', 'score', 'feedback_rating', 'assigned_by', 'Private catalog title', 'Not evidence']) {
      expect(serialized).not.toContain(privateField);
      expect(text).not.toContain(privateField);
    }
    expect(summary.similar_same_format.evidence_ids).toEqual(['evidence-1']);
    expect(summary.similar_same_format.latest_records[0]).toMatchObject({ record_id: 'evidence-1', event_id: online.event_id });
    expect(text).not.toContain('evidence-1');
    expect(text).not.toContain(online.event_id);
    expect(text).not.toContain('online');
    expect(text).toContain('прекращено 1/1');
    expect(text).toContain('не определяют мотивацию');
    expect(text).toContain('не являются вероятностью');
  });

  it('keeps all three populated groups concise with denominators and truncation visible', () => {
    const summary = summarize([candidate, online, selfPaced].flatMap(activity =>
      Array.from({ length: 8 }, (_, index) => row(`internal-${activity.event_id}-${index}`, activity.event_id,
        index % 2 ? 'completed' : 'declined', `2026-09-0${index + 1}`))));
    const text = historyEvidenceText(summary);
    expect(text.length).toBeLessThan(1000);
    expect(text).toContain('2025-10-01–2026-10-01');
    expect(text).toContain('последние 6 из 8 записей');
    expect(text).toContain('завершено 3/6, отказ 3/6');
    expect(text).toContain('Похожие, тот же формат');
    expect(text).toContain('Похожие, другой формат');
    expect(text).not.toContain('internal-');
    expect(text).not.toContain('отказ от назначения');
    for (const group of [summary.exact_event, summary.similar_same_format, summary.similar_other_format]) {
      expect(group.evidence_ids).toHaveLength(6);
      for (const id of group.evidence_ids) expect(text).not.toContain(id);
    }
  });

  it('can omit exact-event copy when a caller supplies its own terminal-outcome scope', () => {
    const summary = summarize([online, selfPaced].flatMap(activity =>
      Array.from({ length: 3 }, (_, index) => row(`${activity.event_id}-${index}`, activity.event_id, 'completed'))));
    expect(historyEvidenceText(summary)).toContain('Эта активность: нет итоговых записей');
    expect(historyEvidenceText(summary)).toContain('данных недостаточно');
    const text = historyEvidenceText(summary, { includeExact: false });
    expect(text).not.toContain('Эта активность');
    expect(text).not.toContain('данных недостаточно');
    expect(text).toContain('Похожие, тот же формат: завершено 3/3');
    expect(text).toContain('Похожие, другой формат: завершено 3/3');
    expect(summary.exact_event.sample_size).toBe(0);
    expect(summary.similar_same_format.evidence_ids).toHaveLength(3);
  });

  it('clamps a leap-day window to February end in the preceding year', () => {
    const summary = summarize([
      row('included', online.event_id, 'completed', '2023-02-28'),
      row('excluded', online.event_id, 'completed', '2023-02-27'),
    ], '2024-02-29');
    expect(summary.window_start).toBe('2023-02-28');
    expect(summary.similar_same_format.evidence_ids).toEqual(['included']);
  });

  it('does not produce voluntary preference evidence for a mandatory candidate', () => {
    const summary = summarizeHistoryEvidence({
      employeeId: 'private-employee-id', asOfDate: '2026-10-01', event: mandatory, events,
      history: [row('mandatory', mandatory.event_id, 'completed'), row('similar', online.event_id, 'completed')],
    });
    expect(summary.exact_event.sample_size + summary.similar_same_format.sample_size + summary.similar_other_format.sample_size).toBe(0);
  });
});
