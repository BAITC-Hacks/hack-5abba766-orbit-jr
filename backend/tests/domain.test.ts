import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { assertCompletionAllowed, catalogView, employeeView, getCandidates, hrOverview, skillChanges } from '../src/domain';
import { pickReasonFactIds } from '../src/domain/baseline';
import { latestTerminalHistoryByEvent } from '../src/domain/baseline-signals';
import type { CompletionRequest, DatasetSnapshot, EmployeeSource, EventView, ParticipationSource, RuntimeCompletion } from '../src/types';

const person: EmployeeSource = {
  employee_id: 'arbitrary-employee', full_name: 'Synthetic Person', department: 'Engineering', role: 'Engineer', grade: 'Junior',
  manager_id: null, hire_date: '2025-01-01', tenure_months: 21, work_format: 'remote', preferred_language: 'ru',
  career_goal: { target_role: 'Engineer', target_grade: 'Middle' }, skills: { A: 1 }, last_review_date: '2026-09-01',
};

function event(id: string, patch: Partial<EventView> = {}): EventView {
  return { event_id: id, title: id, description: 'Authored synthetic activity', type: 'course', format: 'self_paced', duration_hours: 4,
    mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior'], prerequisites: {},
    develops_skills: [{ skill_id: 'A', gain: 1, max_level: 5 }], upcoming_sessions: [], repeatable: false, ...patch };
}

function history(id: string, patch: Partial<ParticipationSource> = {}): ParticipationSource {
  return { record_id: id, employee_id: person.employee_id, event_id: 'course', date: '2026-09-15', due_date: null,
    status: 'in_progress', completion_pct: 50, score: null, feedback_rating: null, assigned_by: 'self', ...patch };
}

function completion(id: string, patch: Partial<RuntimeCompletion> = {}): RuntimeCompletion {
  return { id, employee_id: person.employee_id, event_id: 'course', participation_id: null,
    session_date: null, occurrence_key: 'once', applied_as_of: '2026-10-01', recorded_at: '2026-09-23T10:00:00.000Z', sequence: 1, ...patch };
}

function fixture(patch: Partial<DatasetSnapshot> = {}): DatasetSnapshot {
  return {
    as_of_date: '2026-10-01', dataset_revision: 1, global_revision: 1,
    employees: [structuredClone(person)], employee_revisions: { [person.employee_id]: 0 }, goals: {},
    skills: ['A', 'B', 'C'].map(id => ({ skill_id: id, name: `Skill ${id}`, type: 'hard' as const, category: 'Example', description: 'Authored skill' })),
    role_profiles: [
      { role: 'Engineer', grade: 'Junior', required_skills: { A: 1 }, critical_skills: ['A'] },
      { role: 'Engineer', grade: 'Middle', required_skills: { A: 4, B: 2 }, critical_skills: ['A'] },
      { role: 'Engineer', grade: 'Senior', required_skills: { A: 5, B: 4 }, critical_skills: ['A', 'B'] },
      { role: 'Engineer', grade: 'Lead', required_skills: { A: 5, B: 5 }, critical_skills: ['A', 'B'] },
    ], events: [event('course')], history: [], completions: [],
    proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Confident', '4': 'Advanced', '5': 'Expert' }, ...patch,
  };
}

function request(target: CompletionRequest['target'] = { kind: 'new_participation', event_id: 'course', session_date: null }): CompletionRequest {
  return { expected_version: { dataset_revision: 1, employee_revision: 0 }, simulation: true, target };
}

function expectCode(fn: () => unknown, code: string): void {
  try { fn(); expect.fail(`Expected ${code}`); } catch (error) { expect(error).toBeInstanceOf(AppError); expect((error as AppError).code).toBe(code); }
}

describe('assessed baseline and causal simulation overlays', () => {
  it.each(['toString', 'valueOf', 'hasOwnProperty'])('treats an absent %s skill as zero without reading the object prototype', skillId => {
    const data = fixture({
      skills: [{ skill_id: skillId, name: 'Synthetic inherited-name skill', type: 'hard', category: 'Example', description: 'Authored skill' }],
      employees: [{ ...person, skills: {} }],
      role_profiles: [{ role: 'Engineer', grade: 'Middle', required_skills: { [skillId]: 2 }, critical_skills: [skillId] }],
      events: [event('course', { develops_skills: [{ skill_id: skillId, gain: 1, max_level: 5 }] })],
    });
    const { employee, candidates } = getCandidates(data, person.employee_id);
    expect(employee.skills).toEqual([{ skill_id: skillId, baseline_level: 0, current_level: 0, required_level: 2, gap: 2, critical: true }]);
    expect(employee.progress).toEqual({ coverage: 0, gap_points: 2, missing_critical_skill_ids: [skillId] });
    expect(candidates[0].expected_skill_changes).toEqual([{ skill_id: skillId, before: 0, after: 1, gain: 1 }]);
    expect(candidates[0].goal_coverage_delta).toBe(0.5);
    const after = employeeView({ ...data, completions: [completion('synthetic')] }, person.employee_id);
    expect(after.skills[0]).toMatchObject({ baseline_level: 0, current_level: 1, gap: 1 });
  });

  it('does not invent a target requirement for an inherited-name skill outside the goal', () => {
    const data = fixture();
    data.skills.push({ skill_id: 'toString', name: 'Synthetic skill', type: 'hard', category: 'Example', description: 'Authored skill' });
    const view = employeeView(data, person.employee_id);
    expect(view.skills.find(skill => skill.skill_id === 'toString')).toEqual({
      skill_id: 'toString', baseline_level: 0, current_level: 0, required_level: null, gap: null, critical: false,
    });
  });

  it('only applies source completions strictly after review, in date/id order, once', () => {
    const data = fixture({
      history: [
        history('before', { date: '2026-08-31', status: 'completed', completion_pct: 100 }),
        history('same-day', { date: '2026-09-01', status: 'completed', completion_pct: 100 }),
        history('after', { date: '2026-09-02', status: 'completed', completion_pct: 100 }),
        history('future', { date: '2026-10-02', status: 'completed', completion_pct: 100 }),
        history('partial', { date: '2026-09-03', status: 'in_progress', completion_pct: 95 }),
      ],
    });
    const view = employeeView(data, person.employee_id);
    expect(view.skills.find(skill => skill.skill_id === 'A')).toMatchObject({ baseline_level: 1, current_level: 2 });
    expect(view.skills.find(skill => skill.skill_id === 'B')!.current_level).toBe(0);
    expect(view.progress!.coverage).toBe(2 / 6);
  });

  it('applies a converted in_progress only once and applies runtime on the review day', () => {
    const data = fixture({ employees: [{ ...person, last_review_date: '2026-10-01' }], history: [history('started')], completions: [completion('demo', { participation_id: 'started' })] });
    const view = employeeView(data, person.employee_id);
    expect(view.skills.find(skill => skill.skill_id === 'A')!.current_level).toBe(2);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ source_status: 'in_progress', effective_status: 'completed', completion_origin: 'simulation', completion_pct: 100 });
    expect(view.has_simulated_progress).toBe(true);
  });

  it('preserves levels above an event cap and caps gains at five', () => {
    const data = fixture({ employees: [{ ...person, skills: { A: 4, B: 4 } }],
      events: [event('course', { develops_skills: [{ skill_id: 'A', gain: 2, max_level: 3 }, { skill_id: 'B', gain: 2, max_level: 5 }] })], completions: [completion('demo')] });
    const levels = Object.fromEntries(employeeView(data, person.employee_id).skills.map(skill => [skill.skill_id, skill.current_level]));
    expect(levels).toMatchObject({ A: 4, B: 5 });
  });

  it('uses runtime sequence rather than arbitrary array order for capped effects', () => {
    const data = fixture({ events: [event('low', { develops_skills: [{ skill_id: 'A', gain: 1, max_level: 2 }] }), event('high', { develops_skills: [{ skill_id: 'A', gain: 1, max_level: 5 }] })],
      completions: [completion('later', { event_id: 'high', sequence: 2 }), completion('first', { event_id: 'low', sequence: 1 })] });
    expect(employeeView(data, person.employee_id).skills.find(skill => skill.skill_id === 'A')!.current_level).toBe(3);
  });
});

describe('goal resolution and progress', () => {
  it('resolves selected over imported, explicit clearing to suggested, and Lead without invented next grade', () => {
    expect(employeeView(fixture(), person.employee_id).goal.source).toBe('imported');
    expect(employeeView(fixture({ goals: { [person.employee_id]: { target_role: 'Engineer', target_grade: 'Senior' } } }), person.employee_id).goal).toEqual({ source: 'selected', target: { target_role: 'Engineer', target_grade: 'Senior' } });
    expect(employeeView(fixture({ goals: { [person.employee_id]: null } }), person.employee_id).goal.source).toBe('suggested');
    const lead = fixture({ employees: [{ ...person, grade: 'Lead', career_goal: null }] });
    expect(employeeView(lead, person.employee_id).progress).toBeNull();
    expect(getCandidates(lead, person.employee_id).emptyReason).toBe('GOAL_REQUIRED');
  });

  it('keeps target requirements separate from current-role admission', () => {
    const data = fixture({ employees: [{ ...person, career_goal: { target_role: 'Analyst', target_grade: 'Middle' } }],
      role_profiles: [{ role: 'Analyst', grade: 'Middle', required_skills: { B: 2 }, critical_skills: ['B'] }],
      events: [event('analyst-course', { target_roles: ['Analyst'], develops_skills: [{ skill_id: 'B', gain: 2, max_level: 5 }] })] });
    expect(employeeView(data, person.employee_id).skills.find(skill => skill.skill_id === 'B')!.required_level).toBe(2);
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_ELIGIBLE_EVENTS');
  });

  it('returns GOAL_REACHED when requirements are met, not manufactured activities', () => {
    const data = fixture({ employees: [{ ...person, skills: { A: 4, B: 2 } }] });
    expect(employeeView(data, person.employee_id).progress).toMatchObject({ coverage: 1, gap_points: 0 });
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('GOAL_REACHED');
  });
});

describe('participation identity and admission', () => {
  it('chooses latest date/id active attempt rather than highest percent and grandfathers enrollment', () => {
    const data = fixture({ employees: [{ ...person, grade: 'Senior' }],
      events: [event('course', { format: 'offline', prerequisites: { C: 5 }, upcoming_sessions: [] })],
      history: [history('old', { date: '2026-09-10', completion_pct: 95 }), history('new-a', { date: '2026-09-20', completion_pct: 30 }), history('new-b', { date: '2026-09-20', completion_pct: 10 })] });
    const candidate = getCandidates(data, person.employee_id).candidates[0];
    expect(candidate).toMatchObject({ action: 'continue', participation_id: 'new-b', session_date: '2026-09-20' });
    expect(assertCompletionAllowed(data, person.employee_id, request({ kind: 'existing_participation', participation_id: 'old' }))).toMatchObject({ event_id: 'course', participation_id: 'old', session_date: '2026-09-10' });
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request({ kind: 'new_participation', event_id: 'course', session_date: '2026-09-20' })), 'INELIGIBLE_EVENT');
  });

  it('supersedes other attempts after one completion without rewriting imported status', () => {
    const data = fixture({ history: [history('old'), history('new', { date: '2026-09-20' })], completions: [completion('demo', { participation_id: 'new' })] });
    const view = employeeView(data, person.employee_id);
    expect(view.history.find(row => row.participation_id === 'old')).toMatchObject({ source_status: 'in_progress', effective_status: 'in_progress', actionable: false, superseded_by: 'new' });
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request({ kind: 'existing_participation', participation_id: 'old' })), 'ALREADY_COMPLETED');
    const hr = hrOverview(data);
    expect(hr.participation.actual_by_status.in_progress).toBe(2);
    expect(hr.participation.effective_by_status.in_progress).toBe(0);
    expect(hr.participation.effective_by_status.completed).toBe(1);
    expect(hr.participation.simulated_completions).toBe(1);
    expect(hr.participation.superseded_attempts).toBe(1);
  });

  it('blocks restarting completed source events even when completion is before baseline', () => {
    const data = fixture({ history: [history('done', { date: '2026-08-01', status: 'completed', completion_pct: 100 })] });
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_ELIGIBLE_EVENTS');
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request()), 'ALREADY_COMPLETED');
  });

  it('requires using an existing nonrepeatable attempt and rejects foreign employee participation', () => {
    const data = fixture({ history: [history('started'), history('foreign', { employee_id: 'someone-else' })] });
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request()), 'USE_EXISTING_PARTICIPATION');
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request({ kind: 'existing_participation', participation_id: 'foreign' })), 'NOT_FOUND');
  });

  it('allows separate club sessions while protecting each completed date', () => {
    const data = fixture({ events: [event('club', { format: 'online', repeatable: true, upcoming_sessions: ['2026-11-02', '2026-10-02'] })],
      history: [history('older-club', { event_id: 'club', date: '2026-09-02', status: 'completed', completion_pct: 100 })],
      completions: [completion('first-session', { event_id: 'club', session_date: '2026-10-02', occurrence_key: '2026-10-02' })] });
    expect(getCandidates(data, person.employee_id).candidates[0].session_date).toBe('2026-11-02');
    expectCode(() => assertCompletionAllowed(data, person.employee_id, request({ kind: 'new_participation', event_id: 'club', session_date: '2026-10-02' })), 'SESSION_ALREADY_COMPLETED');
    expect(assertCompletionAllowed(data, person.employee_id, request({ kind: 'new_participation', event_id: 'club', session_date: '2026-11-02' })).occurrence_key).toBe('2026-11-02');
  });

  it('rejects mandatory, missing prerequisites, past or invented sessions, and stale versions', () => {
    expectCode(() => assertCompletionAllowed(fixture({ events: [event('course', { mandatory: true })] }), person.employee_id, request()), 'INELIGIBLE_EVENT');
    expectCode(() => assertCompletionAllowed(fixture({ events: [event('course', { prerequisites: { B: 1 } })] }), person.employee_id, request()), 'INELIGIBLE_EVENT');
    expectCode(() => assertCompletionAllowed(fixture(), person.employee_id, request({ kind: 'new_participation', event_id: 'course', session_date: '2026-11-01' })), 'INELIGIBLE_EVENT');
    const scheduled = fixture({ events: [event('course', { format: 'offline', upcoming_sessions: ['2026-09-01', '2026-11-01'] })] });
    for (const date of [null, '2026-09-01', '2026-12-01']) expectCode(() => assertCompletionAllowed(scheduled, person.employee_id, request({ kind: 'new_participation', event_id: 'course', session_date: date })), 'INELIGIBLE_EVENT');
    expectCode(() => assertCompletionAllowed(fixture(), person.employee_id, { ...request(), expected_version: { dataset_revision: 2, employee_revision: 0 } }), 'REVISION_CONFLICT');
  });

  it('accepts beneficial general completion independently of goal recommendations', () => {
    const data = fixture({ events: [event('course', { develops_skills: [{ skill_id: 'C', gain: 1, max_level: 5 }] })] });
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_GOAL_RELEVANT_EVENTS');
    expect(assertCompletionAllowed(data, person.employee_id, request())).toEqual({ event_id: 'course', participation_id: null, session_date: null, occurrence_key: 'once' });
  });
});

describe('preparation paths and grounded ranking', () => {
  function preparation(): DatasetSnapshot {
    return fixture({ events: [
      event('prepare', { develops_skills: [{ skill_id: 'C', gain: 2, max_level: 2 }] }),
      event('advanced', { prerequisites: { C: 2 }, develops_skills: [{ skill_id: 'A', gain: 3, max_level: 5 }] }),
    ] });
  }

  it('retains a zero-direct-progress activity that opens a useful next activity', () => {
    const { candidates } = getCandidates(preparation(), person.employee_id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ event_id: 'prepare', relevance: 'prerequisite', goal_coverage_delta: 0, unlocks_event_ids: ['advanced'] });
    expect(new Set(candidates[0].facts.map(fact => fact.category))).toEqual(new Set(['grade', 'skill_gap', 'history', 'target_requirement', 'eligibility', 'effort']));
    expect(candidates[0].facts.find(fact => fact.category === 'history')!.text).toContain('нет итоговых исходов');
  });

  it('keeps conditional future gains citable without adding them to preparation progress', () => {
    const data = preparation();
    data.events.push(event('other-future', { prerequisites: { C: 2 }, develops_skills: [{ skill_id: 'B', gain: 2, max_level: 5 }] }));
    const { employee, candidates, signals } = getCandidates(data, person.employee_id);
    const candidate = candidates[0];
    expect(candidate.expected_skill_changes).toEqual([{ skill_id: 'C', before: 0, after: 2, gain: 2 }]);
    expect(candidate.goal_coverage_delta).toBe(0);
    expect(employee.skills.find(skill => skill.skill_id === 'A')!.current_level).toBe(1);
    expect(signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(6);
    const facts = candidate.facts.filter(fact => fact.fact_id.includes(':unlock:'));
    expect(facts).toHaveLength(2);
    const advanced = facts.find(fact => fact.fact_id.endsWith(':advanced'))!;
    expect(advanced.category).toBe('target_requirement');
    expect(advanced.text).toContain('Skill A: 1 → 4');
    expect(advanced.text).toContain('целевых разрывов: 6');
    expect(advanced.text).toContain('не начисляется за подготовительный шаг');
    expect(advanced.text).toContain('не складывается');
    expect(pickReasonFactIds(candidate)).toEqual(expect.arrayContaining(facts.map(fact => fact.fact_id)));
  });

  it('measures future benefit from after preparation and caps it at the remaining goal', () => {
    const data = fixture({ events: [
      event('prepare', { develops_skills: [{ skill_id: 'A', gain: 1, max_level: 5 }] }),
      event('advanced', { prerequisites: { A: 2 }, develops_skills: [{ skill_id: 'A', gain: 3, max_level: 5 }] }),
    ] });
    const { candidates, signals } = getCandidates(data, person.employee_id);
    const candidate = candidates[0];
    expect(candidate.expected_skill_changes).toEqual([{ skill_id: 'A', before: 1, after: 2, gain: 1 }]);
    expect(signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(4);
    const fact = candidate.facts.find(item => item.fact_id.endsWith(':unlock:advanced'))!;
    expect(fact.text).toContain('Skill A: 2 → 5');
    expect(fact.text).toContain('целевых разрывов: 4');
  });

  it('cites exactly the terminal observations used by ranking despite newer ongoing attempts', () => {
    const data = fixture({ history: [
      history('outside-window', { date: '2026-07-01', status: 'no_show' }),
      history('terminal-a', { date: '2026-08-01', status: 'declined' }),
      history('terminal-b', { date: '2026-08-02', status: 'dropped' }),
      history('terminal-c', { date: '2026-08-03', status: 'no_show' }),
      history('ongoing-a', { date: '2026-09-01' }),
      history('ongoing-b', { date: '2026-09-02' }),
      history('ongoing-c', { date: '2026-09-03' }),
      history('future-outcome', { date: '2026-10-02', status: 'no_show' }),
      history('foreign-outcome', { employee_id: 'someone-else', date: '2026-09-30', status: 'declined' }),
    ] });
    const { candidates, signals } = getCandidates(data, person.employee_id);
    const candidate = candidates[0];
    expect(signals.negativeOutcomes.get(candidate.candidate_id)).toBe(3);
    const text = candidate.facts.find(fact => fact.category === 'history')!.text;
    expect(text).toContain('Итоговые исходы этой активности на 2026-10-01');
    expect(text).toContain('2026-08-03 — пропуск; 2026-08-02 — прекращено; 2026-08-01 — отказ');
    expect(text).toContain('Отказов, пропусков и прекращений: 3');
    expect(text).toContain('Текущее участие от 2026-09-03: в процессе (50%)');
    const observed = latestTerminalHistoryByEvent(new Set(['course']), {
      employeeId: person.employee_id, asOfDate: data.as_of_date, history: data.history,
    }).get('course');
    expect(observed?.map(row => row.record_id)).toEqual(['terminal-c', 'terminal-b', 'terminal-a']);
    for (const row of data.history) expect(text).not.toContain(row.record_id);
    for (const excludedDate of ['2026-07-01', '2026-10-02', '2026-09-30', '2026-09-01', '2026-09-02']) expect(text).not.toContain(excludedDate);
  });

  it('requires all prerequisites and positive remaining target gain after preparation', () => {
    const data = preparation();
    data.events[1].prerequisites.B = 2;
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_GOAL_RELEVANT_EVENTS');
    delete data.events[1].prerequisites.B;
    data.events[1].develops_skills = [{ skill_id: 'C', gain: 1, max_level: 3 }];
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_GOAL_RELEVANT_EVENTS');
  });

  it('requires a strictly later scheduled follow-up and treats self-paced timing conditionally', () => {
    const data = preparation();
    data.events[0].format = 'online'; data.events[0].upcoming_sessions = ['2026-11-02'];
    data.events[1].format = 'online'; data.events[1].upcoming_sessions = ['2026-11-01', '2026-11-02'];
    expect(getCandidates(data, person.employee_id).emptyReason).toBe('NO_GOAL_RELEVANT_EVENTS');
    data.events[1].upcoming_sessions.push('2026-11-03');
    expect(getCandidates(data, person.employee_id).candidates[0].unlocks_event_ids).toEqual(['advanced']);
    data.events[0].format = 'self_paced'; data.events[0].upcoming_sessions = [];
    expect(getCandidates(data, person.employee_id).candidates[0].facts.find(fact => fact.category === 'skill_gap')!.text).toContain('проверить заново');
  });

  it('prefers closing critical gaps, then weighted benefit, history and effort', () => {
    const data = fixture({ events: [
      event('cheap-soft', { duration_hours: 1, develops_skills: [{ skill_id: 'B', gain: 2, max_level: 5 }] }),
      event('critical', { duration_hours: 100, develops_skills: [{ skill_id: 'A', gain: 3, max_level: 5 }] }),
      event('partial-critical', { duration_hours: 2, develops_skills: [{ skill_id: 'A', gain: 1, max_level: 5 }] }),
      event('same-but-declined', { duration_hours: 1 }),
    ], history: [history('declined', { event_id: 'same-but-declined', status: 'declined', completion_pct: 0 })] });
    expect(getCandidates(data, person.employee_id).candidates.map(candidate => candidate.event_id)).toEqual(['critical', 'cheap-soft', 'partial-critical', 'same-but-declined']);
  });

  it('distinguishes unavailable activities from cap-limited activities', () => {
    expect(getCandidates(fixture({ events: [event('course', { mandatory: true })] }), person.employee_id).emptyReason).toBe('NO_ELIGIBLE_EVENTS');
    expect(getCandidates(fixture({ events: [event('course', { develops_skills: [{ skill_id: 'A', gain: 1, max_level: 1 }] })] }), person.employee_id).emptyReason).toBe('NO_BENEFICIAL_EVENTS');
  });
});

describe('consistent views and analytics', () => {
  it('keeps a new mandatory assignment in effective counts after an older completion', () => {
    const data = fixture({
      events: [event('course', { mandatory: true })],
      history: [
        history('completed-assignment', { date: '2026-08-01', status: 'completed', completion_pct: 100 }),
        history('current-assignment', { date: '2026-09-15' }),
      ],
    });
    expect(employeeView(data, person.employee_id).history.find(row => row.participation_id === 'current-assignment'))
      .toMatchObject({ source_status: 'in_progress', effective_status: 'in_progress', actionable: false, superseded_by: null });
    const { participation } = hrOverview(data);
    expect(participation.superseded_attempts).toBe(0);
    expect(participation.effective_by_status).toEqual(participation.actual_by_status);
    expect(participation.by_activity[0].effective_by_status).toMatchObject({ completed: 1, in_progress: 1 });
  });

  it('counts skill gaps against employees whose goals require that skill, separately per goal source', () => {
    const second = { ...person, employee_id: 'second', career_goal: null };
    const lead = { ...person, employee_id: 'lead', grade: 'Lead' as const, career_goal: null };
    const data = fixture({ employees: [person, second, lead] });
    const hr = hrOverview(data);
    expect(hr.goals_by_source).toEqual({ imported: 1, suggested: 1, selected: 0, missing: 1 });
    expect(hr.skill_gaps.find(gap => gap.skill_id === 'A' && gap.goal_source === 'imported')).toMatchObject({ denominator: 1, employees_with_gap: 1, total_gap_points: 3 });
    expect(hr.no_next_step).toContainEqual({ employee_id: 'lead', full_name: person.full_name, goal_source: 'missing', reason: 'GOAL_REQUIRED' });
  });

  it('does not mutate source input and returns exact computed changes', () => {
    const data = fixture();
    const original = structuredClone(data);
    const before = employeeView(data, person.employee_id);
    getCandidates(data, person.employee_id); hrOverview(data);
    const catalog = catalogView(data); catalog.events[0].title = 'Changed copy';
    expect(data).toEqual(original);
    const after = employeeView({ ...data, completions: [completion('new')] }, person.employee_id);
    expect(skillChanges(before, after)).toEqual([{ skill_id: 'A', before: 1, after: 2, gain: 1 }]);
  });
});
