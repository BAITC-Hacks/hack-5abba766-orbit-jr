import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCompletionAllowed, employeeView, getCandidates, hrOverview, skillChanges } from '../src/domain';
import { loadDataset } from '../src/validation/load-dataset';
import { sourceHash } from '../src/validation';

// Local opt-in regression audit. The official dataset is never committed or replaced by fixtures.
const source = fileURLToPath(new URL('../../data/source/', import.meta.url));
const files = ['employees.json', 'events.json', 'skills.json', 'activity_history.csv'];
const missing = files.filter(file => !existsSync(source + file));
if (missing.length > 0 && missing.length < files.length) {
  throw new Error(`Official dataset is incomplete. Missing in data/source: ${missing.join(', ')}`);
}
const available = missing.length === 0;
const official = describe.skipIf(!available);

official('official local dataset domain audit', () => {
  it('finishes complete local journeys without duplicate effects or unbounded loops', async () => {
    const sourceSnapshot = await loadDataset(source);
    const originalHash = sourceHash(sourceSnapshot);
    const terminalCounts: Record<string, number> = {};
    let totalSteps = 0;
    let longestJourney = 0;
    for (const person of sourceSnapshot.employees) {
      let snapshot = { ...sourceSnapshot, employee_revisions: { ...sourceSnapshot.employee_revisions } };
      const visited = new Set<string>();
      // Each nonrepeatable event or dated repeatable occurrence can be completed once.
      // Count history dates too, because an already-started session retains eligibility.
      const bound = snapshot.events.reduce((sum, event) => sum + (event.repeatable
        ? new Set([...event.upcoming_sessions, ...snapshot.history.filter(row =>
          row.employee_id === person.employee_id && row.event_id === event.event_id).map(row => row.date)]).size
        : 1), 0);
      for (let step = 0; step <= bound; step++) {
        const { employee, candidates, emptyReason } = getCandidates(snapshot, person.employee_id);
        if (!candidates.length) {
          expect(emptyReason).not.toBeNull();
          terminalCounts[emptyReason!] = (terminalCounts[emptyReason!] ?? 0) + 1;
          longestJourney = Math.max(longestJourney, step);
          break;
        }
        expect(step).toBeLessThan(bound);
        const candidate = candidates[0];
        const allowed = assertCompletionAllowed(snapshot, person.employee_id, {
          expected_version: employee.version, simulation: true,
          target: candidate.action === 'continue'
            ? { kind: 'existing_participation', participation_id: candidate.participation_id! }
            : { kind: 'new_participation', event_id: candidate.event_id, session_date: candidate.session_date },
        });
        const identity = JSON.stringify([allowed.event_id, allowed.occurrence_key]);
        expect(visited.has(identity)).toBe(false);
        visited.add(identity);
        snapshot = { ...snapshot,
          employee_revisions: { ...snapshot.employee_revisions, [person.employee_id]: employee.version.employee_revision + 1 },
          global_revision: snapshot.global_revision + 1,
          completions: [...snapshot.completions, { id: `audit-step-${step}`, employee_id: person.employee_id, ...allowed,
            applied_as_of: snapshot.as_of_date, recorded_at: '2026-09-23T10:00:00.000Z', sequence: step + 1 }],
        };
        const after = employeeView(snapshot, person.employee_id);
        const changes = skillChanges(employee, after);
        expect(changes).toEqual(candidate.expected_skill_changes);
        expect(changes.length).toBeGreaterThan(0);
        for (const change of changes) expect(change.gain).toBeGreaterThan(0);
        for (const skill of after.skills) {
          expect(Number.isFinite(skill.current_level)).toBe(true);
          expect(skill.current_level).toBeGreaterThanOrEqual(0);
          expect(skill.current_level).toBeLessThanOrEqual(5);
        }
        expect(after.progress!.coverage).toBeGreaterThanOrEqual(employee.progress!.coverage);
        expect(after.progress!.coverage - employee.progress!.coverage).toBeCloseTo(candidate.goal_coverage_delta, 12);
        expect(new Set(after.history.map(row => row.participation_id)).size).toBe(after.history.length);
        totalSteps++;
      }
    }
    expect(Object.values(terminalCounts).reduce((sum, count) => sum + count, 0)).toBe(sourceSnapshot.employees.length);
    expect(sourceHash(sourceSnapshot)).toBe(originalHash);
    console.info(JSON.stringify({ localDatasetJourneys: sourceSnapshot.employees.length, totalSteps, longestJourney, terminalCounts }));
  }, 30_000);

  it('every suggested alternative produces exactly its advertised independent effect', async () => {
    const snapshot = await loadDataset(source);
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
        const categories = new Set(candidate.facts.map(fact => fact.category));
        for (const category of ['grade', 'skill_gap', 'history', 'target_requirement', 'eligibility', 'effort'] as const) {
          expect(categories.has(category)).toBe(true);
        }
        expect(new Set(candidate.facts.map(fact => fact.fact_id)).size).toBe(candidate.facts.length);
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

  it('handles the known baseline, previous-grade, and duplicate-attempt cases', async () => {
    const snapshot = await loadDataset(source);
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
