import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { assertCompletionAllowed, employeeView, getCandidates, hrOverview, skillChanges } from '../src/domain';
import type { DatasetSnapshot, EventView, ParticipationSource } from '../src/types';

// Local opt-in regression audit. The official dataset is never committed or replaced by fixtures.
const source = fileURLToPath(new URL('../../data/source/', import.meta.url));
const available = ['employees.json', 'events.json', 'skills.json', 'activity_history.csv'].every(file => existsSync(source + file));
const official = describe.skipIf(!available);

function readDataset(): DatasetSnapshot {
  const employees = JSON.parse(readFileSync(source + 'employees.json', 'utf8'));
  const skills = JSON.parse(readFileSync(source + 'skills.json', 'utf8'));
  const events = JSON.parse(readFileSync(source + 'events.json', 'utf8')).events as EventView[];
  const rows = parse(readFileSync(source + 'activity_history.csv', 'utf8'), { columns: true, bom: true }) as Record<string, string>[];
  return {
    as_of_date: employees.meta.as_of_date, dataset_revision: 1, global_revision: 1,
    employees: employees.employees, employee_revisions: {}, skills: skills.skills,
    role_profiles: skills.role_profiles, proficiency_scale: skills.proficiency_scale,
    events: events.map(event => ({ ...event, repeatable: event.event_id === 'EV_036' })),
    history: rows.map(row => ({ ...row, due_date: row.due_date || null, completion_pct: Number(row.completion_pct),
      score: row.score === '' ? null : Number(row.score), feedback_rating: row.feedback_rating === '' ? null : Number(row.feedback_rating) })) as ParticipationSource[],
    completions: [], goals: {},
  };
}

official('official local dataset domain audit', () => {
  it('every suggested alternative produces exactly its advertised independent effect', () => {
    const snapshot = readDataset();
    let checked = 0;
    for (const sourceEmployee of snapshot.employees) {
      const employeeId = sourceEmployee.employee_id;
      const { employee, candidates } = getCandidates(snapshot, employeeId);
      for (const candidate of candidates) {
        const allowed = assertCompletionAllowed(snapshot, employeeId, {
          expected_version: employee.version, simulation: true,
          target: candidate.action === 'continue'
            ? { kind: 'existing_participation', participation_id: candidate.participation_id! }
            : { kind: 'new_participation', event_id: candidate.event_id, session_date: candidate.session_date },
        });
        const after = employeeView({ ...snapshot, completions: [{ id: 'audit-only', employee_id: employeeId, ...allowed,
          applied_as_of: snapshot.as_of_date, recorded_at: '2026-09-23T10:00:00.000Z', sequence: 1 }] }, employeeId);
        expect(skillChanges(employee, after)).toEqual(candidate.expected_skill_changes);
        expect(after.progress!.coverage - employee.progress!.coverage).toBeCloseTo(candidate.goal_coverage_delta, 12);
        expect(candidate.facts).toHaveLength(6 + candidate.unlocks_event_ids.length);
        for (const eventId of candidate.unlocks_event_ids) {
          expect(candidate.facts).toContainEqual(expect.objectContaining({
            fact_id: `${candidate.candidate_id}:unlock:${encodeURIComponent(eventId)}`,
            category: 'target_requirement',
          }));
        }
        expect(snapshot.events.find(event => event.event_id === candidate.event_id)!.mandatory).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    const hr = hrOverview(snapshot);
    expect(Object.values(hr.participation.actual_by_status).reduce((a, b) => a + b, 0)).toBe(snapshot.history.length);
    expect(hr.participation.effective_by_status).toEqual(hr.participation.actual_by_status);
  });

  it('handles the known baseline, previous-grade, and duplicate-attempt cases', () => {
    const snapshot = readDataset();
    expect(employeeView(snapshot, 'E0001').skills.find(skill => skill.skill_id === 'SK_APP_SECURITY'))
      .toMatchObject({ baseline_level: 0, current_level: 1 });
    expect(getCandidates(snapshot, 'E0181').candidates.find(candidate => candidate.event_id === 'EV_022'))
      .toMatchObject({ action: 'continue', participation_id: 'R002711' });
    const selectedGoal = { ...snapshot, goals: { E0009: { target_role: 'Customer Support Specialist', target_grade: 'Middle' as const } } };
    expect(getCandidates(selectedGoal, 'E0009').candidates.find(candidate => candidate.event_id === 'EV_035'))
      .toMatchObject({ action: 'continue', participation_id: 'R002715' });
    const before = employeeView(snapshot, 'E0009');
    const allowed = assertCompletionAllowed(snapshot, 'E0009', {
      expected_version: before.version, simulation: true, target: { kind: 'existing_participation', participation_id: 'R002715' },
    });
    const after = employeeView({ ...snapshot, completions: [{ id: 'audit-only', employee_id: 'E0009', ...allowed,
      applied_as_of: snapshot.as_of_date, recorded_at: '2026-09-23T10:00:00.000Z', sequence: 1 }] }, 'E0009');
    expect(after.history.find(row => row.participation_id === 'R002656')).toMatchObject({ actionable: false, superseded_by: 'R002715' });
    expect(skillChanges(before, after).reduce((total, change) => total + change.gain, 0)).toBe(2);
  });
});
