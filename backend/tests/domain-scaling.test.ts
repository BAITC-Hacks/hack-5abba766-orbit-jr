import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { employeeView, getCandidates, hrOverview } from '../src/domain';
import { loadDataset } from '../src/validation/load-dataset';
import { scalingSnapshot } from './fixtures/scaling';

describe('domain scaling on authored synthetic history', () => {
  it('accepts the scaling fixture through the actual source loader at both history distributions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cq-scaling-'));
    try {
      for (const people of [1000, 1]) {
        const snapshot = scalingSnapshot(people);
        const meta = { dataset: 'Authored scaling test', version: '1', as_of_date: snapshot.as_of_date };
        const documents = {
          'employees.json': { meta, employees: snapshot.employees },
          'skills.json': { meta, skills: snapshot.skills, role_profiles: snapshot.role_profiles, proficiency_scale: snapshot.proficiency_scale },
          'events.json': { meta, events: snapshot.events.map(({ repeatable: _repeatable, ...event }) => event) },
        };
        for (const [name, document] of Object.entries(documents)) await writeFile(path.join(directory, name), JSON.stringify(document));
        const columns = Object.keys(snapshot.history[0]) as (keyof typeof snapshot.history[number])[];
        const csv = [columns.join(','), ...snapshot.history.map(row => columns.map(column => row[column] ?? '').join(','))].join('\n');
        await writeFile(path.join(directory, 'activity_history.csv'), csv);
        expect(await loadDataset(directory)).toEqual(snapshot);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 15000);

  it('keeps full-company recommendations identical to each employee history scope at 1000 employees and 50000 records', () => {
    const snapshot = scalingSnapshot();
    const histories = new Map<string, typeof snapshot.history>();
    for (const row of snapshot.history) {
      const rows = histories.get(row.employee_id) ?? [];
      rows.push(row);
      histories.set(row.employee_id, rows);
    }
    const started = performance.now();
    const all = snapshot.employees.map(employee => getCandidates(snapshot, employee.employee_id));
    const recommendationsMs = performance.now() - started;
    // Every effect, fact, signal, participation identity, and empty-state reason
    // must be independent of the other 999 employees' histories.
    snapshot.employees.forEach((employee, index) => {
      expect(all[index]).toEqual(getCandidates({ ...snapshot, employees: [employee],
        history: histories.get(employee.employee_id)! }, employee.employee_id));
    });
    const hrStarted = performance.now();
    const hr = hrOverview(snapshot);
    const hrMs = performance.now() - hrStarted;
    expect(hr.no_next_step).toEqual(all.filter(result => result.emptyReason).map(({ employee, emptyReason }) => ({
      employee_id: employee.employee_id, full_name: employee.full_name, goal_source: employee.goal.source, reason: emptyReason,
    })).sort((a, b) => a.employee_id < b.employee_id ? -1 : a.employee_id > b.employee_id ? 1 : 0));
    expect(hr.participation.actual_by_status.completed + hr.participation.actual_by_status.in_progress
      + hr.participation.actual_by_status.declined + hr.participation.actual_by_status.dropped).toBe(50_000);
    expect(hrMs).toBeLessThan(2000);
    console.info(JSON.stringify({ employees: 1000, history: 50_000, candidates: all.reduce((sum, result) => sum + result.candidates.length, 0),
      recommendationsMs: Math.round(recommendationsMs), hrMs: Math.round(hrMs) }));
    // This checks 1,000 full outputs twice; allow shared CI hosts to finish the
    // parity assertions. The separate two-second HR latency assertion stays intact.
  }, 60000);

  it('handles 50000 attempts for one employee without quadratic participation projection', () => {
    const snapshot = scalingSnapshot(1, 50_000);
    const started = performance.now();
    const projected = employeeView(snapshot, snapshot.employees[0].employee_id);
    const elapsed = performance.now() - started;
    expect(projected.history).toHaveLength(50_000);
    expect(projected.skills.every(skill => Number.isFinite(skill.current_level))).toBe(true);
    expect(projected.history.filter(row => row.superseded_by).every(row => !row.actionable)).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    console.info(JSON.stringify({ employees: 1, history: 50_000, projectionMs: Math.round(elapsed) }));
  }, 10000);

  it('rebuilds request-local indexes after the same snapshot receives a completion overlay', () => {
    const snapshot = scalingSnapshot(1, 0);
    const id = snapshot.employees[0].employee_id;
    const initial = getCandidates(snapshot, id);
    const chosen = initial.candidates.find(candidate => candidate.format === 'self_paced')!;
    snapshot.completions.push({ id: 'SYNTHETIC_OVERLAY', employee_id: id, event_id: chosen.event_id, participation_id: null,
      session_date: null, occurrence_key: 'once', applied_as_of: snapshot.as_of_date,
      recorded_at: '2026-10-01T00:00:00.000Z', sequence: 1 });
    snapshot.employee_revisions[id]++;
    const updated = getCandidates(snapshot, id);
    expect(updated.candidates.some(candidate => candidate.event_id === chosen.event_id)).toBe(false);
    expect(updated.employee.version.employee_revision).toBe(2);
    expect(updated.employee.history).toContainEqual(expect.objectContaining({ participation_id: 'SYNTHETIC_OVERLAY', effective_status: 'completed' }));
    expect(initial.employee.history).toEqual([]);
  });
});
