import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { employeeView } from '../src/domain';
import { buildCatalogCoverageGaps } from '../src/domain/catalog-coverage';
import type { DatasetSnapshot, EmployeeView, EventView, ParticipationSource, SkillView } from '../src/types';

function skill(patch: Partial<SkillView> = {}): SkillView {
  return { skill_id: 'TEST_DESIGN', baseline_level: 1, current_level: 1, required_level: 3, gap: 2, critical: false, ...patch };
}

function employee(id = 'person-a', patch: Partial<EmployeeView> = {}): EmployeeView {
  return {
    employee_id: id, full_name: 'Synthetic employee', role: 'Engineer', grade: 'Junior', department: 'Engineering',
    version: { dataset_revision: 1, employee_revision: 0 }, work_format: 'remote', tenure_months: 12,
    preferred_language: 'ru', last_review_date: '2026-09-01',
    goal: { source: 'selected', target: { target_role: 'Engineer', target_grade: 'Middle' } },
    progress: { coverage: 1 / 3, gap_points: 2, missing_critical_skill_ids: [] },
    skills: [skill()], history: [], has_simulated_progress: false, ...patch,
  };
}

function event(id = 'course', patch: Partial<EventView> = {}): EventView {
  return {
    event_id: id, title: id, description: 'Synthetic course', type: 'course', format: 'self_paced',
    duration_hours: 2, mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior'],
    prerequisites: {}, develops_skills: [{ skill_id: 'TEST_DESIGN', gain: 1, max_level: 4 }],
    upcoming_sessions: [], repeatable: false, ...patch,
  };
}

describe('HR structural catalog coverage', () => {
  it('separates a globally missing voluntary skill from mandatory and zero-gain activities', () => {
    const events = [event('mandatory', { mandatory: true }),
      event('zero-gain', { develops_skills: [{ skill_id: 'TEST_DESIGN', gain: 0, max_level: 5 }] })];
    expect(buildCatalogCoverageGaps({ events }, [employee()])).toEqual([{
      skill_id: 'TEST_DESIGN', reason: 'NO_VOLUNTARY_CATALOG_COVERAGE', employee_ids: ['person-a'],
      employee_count: 1, critical_employee_count: 0, related_event_ids: [], audience_event_ids: [],
    }]);
  });

  it('reports an exhausted audience cap without claiming the skill is absent from the catalog', () => {
    const result = buildCatalogCoverageGaps({ events: [event('intro', {
      develops_skills: [{ skill_id: 'TEST_DESIGN', gain: 2, max_level: 1 }],
    })] }, [employee()]);
    expect(result[0]).toMatchObject({ reason: 'LEVEL_CAP_REACHED', related_event_ids: ['intro'], audience_event_ids: ['intro'] });
    expect(buildCatalogCoverageGaps({ events: [event('next', {
      develops_skills: [{ skill_id: 'TEST_DESIGN', gain: 1, max_level: 2 }],
    })] }, [employee()])).toEqual([]); // Partial improvement is coverage, not proof of reaching level 3.
  });

  it.each([
    { target_roles: ['Analyst'] },
    { target_grades: ['Middle'] as EventView['target_grades'] },
  ])('uses current role and grade for catalog audience, not the target role or grade (%j)', patch => {
    const result = buildCatalogCoverageGaps({ events: [event('other-audience', patch)] }, [employee('person-a', {
      goal: { source: 'selected', target: { target_role: 'Analyst', target_grade: 'Middle' } },
    })]);
    expect(result[0]).toMatchObject({ reason: 'AUDIENCE_MISMATCH', related_event_ids: ['other-audience'], audience_event_ids: [] });
  });

  it('counts distinct affected employees and criticality per skill/reason in deterministic order', () => {
    const ordinary = employee('z-person');
    const critical = employee('a-person', { skills: [skill({ critical: true })] });
    const before = structuredClone([ordinary, critical]);
    const result = buildCatalogCoverageGaps({ events: [] }, [ordinary, critical, critical]);
    expect(result[0]).toMatchObject({ employee_ids: ['a-person', 'z-person'], employee_count: 2, critical_employee_count: 1 });
    expect([ordinary, critical]).toEqual(before);
  });

  it('skips missing goals, met requirements and skills outside the target', () => {
    const views = [employee('no-goal', { goal: { source: 'missing', target: null } }),
      employee('met', { skills: [skill({ current_level: 3, gap: 0 })] }),
      employee('not-required', { skills: [skill({ required_level: null, gap: null })] })];
    expect(buildCatalogCoverageGaps({ events: [] }, views)).toEqual([]);
  });

  it('leaves prerequisites, missing sessions and completed history to actual candidate eligibility', () => {
    const conditional = event('conditional', { format: 'online', upcoming_sessions: [], prerequisites: { FOUNDATION: 4 } });
    const view = employee('person-a', { history: [{
      participation_id: 'previous', event_id: 'conditional', event_title: 'Conditional course', source_status: 'completed',
      effective_status: 'completed', completion_pct: 100, scheduled_session_date: '2025-01-01', source_date: '2025-01-01',
      completion_origin: 'imported', applied_as_of: '2025-01-01', recorded_at: null, actionable: false, superseded_by: null,
    }] });
    expect(buildCatalogCoverageGaps({ events: [conditional] }, [view])).toEqual([]);
  });

  it('does not flag an audience mismatch for previously admitted actionable participation', () => {
    const view = employee('person-a', { history: [{
      participation_id: 'active', event_id: 'admitted', event_title: 'Admitted earlier', source_status: 'in_progress',
      effective_status: 'in_progress', completion_pct: 50, scheduled_session_date: '2025-01-01', source_date: '2025-01-01',
      completion_origin: null, applied_as_of: null, recorded_at: null, actionable: true, superseded_by: null,
    }] });
    expect(buildCatalogCoverageGaps({ events: [event('admitted', { target_roles: ['Analyst'] })] }, [view])).toEqual([]);
  });

  it('keeps different reasons for the same skill separate and aggregates relevant event IDs only', () => {
    const snapshot = { events: [event('intro', { develops_skills: [{ skill_id: 'TEST_DESIGN', gain: 1, max_level: 1 }] })] };
    const result = buildCatalogCoverageGaps(snapshot, [employee('capped'), employee('audience', { role: 'Designer' })]);
    expect(result).toHaveLength(2);
    expect(result.find(row => row.reason === 'LEVEL_CAP_REACHED')).toMatchObject({ employee_ids: ['capped'], audience_event_ids: ['intro'] });
    expect(result.find(row => row.reason === 'AUDIENCE_MISMATCH')).toMatchObject({ employee_ids: ['audience'], audience_event_ids: [] });
  });
});

// Optional regression over the local official dataset; no employee data is committed.
const source = fileURLToPath(new URL('../../data/source/', import.meta.url));
const available = ['employees.json', 'events.json', 'skills.json', 'activity_history.csv'].every(file => existsSync(source + file));
describe.skipIf(!available)('local official dataset catalog gaps', () => {
  it('identifies the uncovered Test Design deficit from computed employee projections', () => {
    const people = JSON.parse(readFileSync(source + 'employees.json', 'utf8'));
    const skills = JSON.parse(readFileSync(source + 'skills.json', 'utf8'));
    const events = JSON.parse(readFileSync(source + 'events.json', 'utf8')).events as EventView[];
    const rows = parse(readFileSync(source + 'activity_history.csv', 'utf8'), { columns: true, bom: true }) as Record<string, string>[];
    const snapshot: DatasetSnapshot = {
      as_of_date: people.meta.as_of_date, dataset_revision: 1, global_revision: 1,
      employees: people.employees, employee_revisions: {}, skills: skills.skills, role_profiles: skills.role_profiles,
      proficiency_scale: skills.proficiency_scale, events: events.map(item => ({ ...item, repeatable: item.event_id === 'EV_036' })),
      history: rows.map(row => ({ ...row, due_date: row.due_date || null, completion_pct: Number(row.completion_pct),
        score: row.score === '' ? null : Number(row.score), feedback_rating: row.feedback_rating === '' ? null : Number(row.feedback_rating),
      })) as ParticipationSource[], completions: [], goals: {},
    };
    const views = snapshot.employees.map(person => employeeView(snapshot, person.employee_id));
    const expected = views.filter(view => view.goal.target && view.skills.some(item => item.skill_id === 'SK_TEST_DESIGN' && (item.gap ?? 0) > 0));
    expect(expected.length).toBeGreaterThan(0);
    expect(buildCatalogCoverageGaps(snapshot, views).find(row => row.skill_id === 'SK_TEST_DESIGN')).toMatchObject({
      reason: 'NO_VOLUNTARY_CATALOG_COVERAGE', employee_count: expected.length,
      employee_ids: expected.map(view => view.employee_id).sort(), related_event_ids: [], audience_event_ids: [],
    });
  });
});
