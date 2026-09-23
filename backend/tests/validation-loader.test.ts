import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import type { EmployeeSource, EventView, ParticipationSource, RoleProfile, SkillDefinition } from '../src/types';
import { checked, dateSchema, employeeSchema, parseEmployeeFile, parseHistoryCsv, parseJson, sourceHash, validateRelations } from '../src/validation';
import { loadDataset } from '../src/validation/load-dataset';

const meta = { dataset: 'Authored validation fixture', version: '1', as_of_date: '2028-06-15' };
const columns = ['record_id', 'employee_id', 'event_id', 'date', 'due_date', 'status', 'completion_pct', 'score', 'feedback_rating', 'assigned_by'] as const;
const temporaryDirectories: string[] = [];

function employee(patch: Partial<EmployeeSource> = {}): EmployeeSource {
  return { employee_id: 'synthetic-person', full_name: 'Synthetic Person', department: 'Research', role: 'Researcher', grade: 'Junior',
    manager_id: null, hire_date: '2027-01-01', tenure_months: 17, work_format: 'remote', preferred_language: 'en',
    career_goal: null, skills: { SYNTH_SKILL: 1 }, last_review_date: '2028-04-01', ...patch };
}

function event(patch: Partial<Omit<EventView, 'repeatable'>> = {}): Omit<EventView, 'repeatable'> {
  return { event_id: 'synthetic-course', title: 'Synthetic Course', description: 'Authored activity', type: 'course', format: 'self_paced',
    duration_hours: 2, mandatory: false, target_roles: ['Researcher'], target_grades: ['Junior'], prerequisites: {},
    develops_skills: [{ skill_id: 'SYNTH_SKILL', gain: 1, max_level: 5 }], upcoming_sessions: [], ...patch };
}

function history(patch: Partial<ParticipationSource> = {}): ParticipationSource {
  return { record_id: 'synthetic-attempt', employee_id: 'synthetic-person', event_id: 'synthetic-course', date: '2028-05-01',
    due_date: null, status: 'in_progress', completion_pct: 50, score: null, feedback_rating: null, assigned_by: 'self', ...patch };
}

function skill(skill_id = 'SYNTH_SKILL'): SkillDefinition {
  return { skill_id, name: 'Synthetic Skill', type: 'hard', category: 'Research', description: 'Authored skill' };
}

function files() {
  return {
    people: { meta: { ...meta }, employees: [employee()] },
    catalog: { meta: { ...meta }, proficiency_scale: { '0': 'None', '1': 'Basic', '2': 'Working', '3': 'Good', '4': 'Advanced', '5': 'Expert' },
      skills: [skill()], role_profiles: [{ role: 'Researcher', grade: 'Junior', required_skills: { SYNTH_SKILL: 2 }, critical_skills: ['SYNTH_SKILL'] }] as RoleProfile[] },
    activities: { meta: { ...meta }, events: [event()] },
    history: [history()],
  };
}

function csv(rows: ParticipationSource[]): string {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${columns.join(',')}\n${rows.map(row => columns.map(column => cell(row[column])).join(',')).join('\n')}\n`;
}

async function load(input = files()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbit-validation-'));
  temporaryDirectories.push(directory);
  await Promise.all([
    writeFile(path.join(directory, 'employees.json'), JSON.stringify(input.people)),
    writeFile(path.join(directory, 'skills.json'), JSON.stringify(input.catalog)),
    writeFile(path.join(directory, 'events.json'), JSON.stringify(input.activities)),
    writeFile(path.join(directory, 'activity_history.csv'), csv(input.history)),
  ]);
  return loadDataset(directory);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('dataset relation invariants', () => {
  it.each(['toString', 'valueOf', 'hasOwnProperty'])('rejects inherited %s as a missing critical skill', async skillId => {
    const input = files();
    input.catalog.role_profiles[0].critical_skills = [skillId];
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['toString', 'valueOf', 'hasOwnProperty'])('preserves %s when it is an explicitly declared identifier', async skillId => {
    const input = files();
    input.people.employees[0] = employee({ employee_id: skillId, skills: { [skillId]: 1 } });
    input.catalog.skills = [skill(skillId)];
    input.catalog.role_profiles[0] = { role: 'Researcher', grade: 'Junior', required_skills: { [skillId]: 2 }, critical_skills: [skillId] };
    input.activities.events[0] = event({ event_id: skillId, prerequisites: { [skillId]: 1 }, develops_skills: [{ skill_id: skillId, gain: 1, max_level: 5 }] });
    input.history[0] = history({ record_id: skillId, employee_id: skillId, event_id: skillId });
    const snapshot = await load(input);
    expect(Object.hasOwn(snapshot.employee_revisions, skillId)).toBe(true);
    expect(snapshot.employees[0].skills[skillId]).toBe(1);
    expect(snapshot.role_profiles[0].required_skills[skillId]).toBe(2);
    expect(validateRelations(snapshot)).toEqual([]);
  });

  it('rejects skill keys that collide after identifier normalization', () => {
    expect(() => checked(employeeSchema, employee({ skills: { SYNTH_SKILL: 1, ' SYNTH_SKILL ': 5 } })))
      .toThrow(AppError);
  });

  it('normalizes a skill key once without losing its level', () => {
    expect(checked(employeeSchema, employee({ skills: { ' SYNTH_SKILL ': 3 } })).skills).toEqual({ SYNTH_SKILL: 3 });
  });

  it.each(['people', 'catalog', 'activities'] as const)('rejects an inconsistent %s snapshot date', async file => {
    const input = files();
    input[file].meta.as_of_date = '2028-06-16';
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['employees', 'skills', 'roles', 'events', 'history'] as const)('rejects duplicate %s identifiers', async kind => {
    const input = files();
    if (kind === 'employees') input.people.employees.push(employee());
    if (kind === 'skills') input.catalog.skills.push(skill());
    if (kind === 'roles') input.catalog.role_profiles.push(structuredClone(input.catalog.role_profiles[0]));
    if (kind === 'events') input.activities.events.push(event());
    if (kind === 'history') input.history.push(history());
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['employee', 'event', 'manager', 'skill', 'role', 'goal'] as const)('rejects an unknown %s reference', async reference => {
    const input = files();
    if (reference === 'employee') input.history[0].employee_id = 'missing-person';
    if (reference === 'event') input.history[0].event_id = 'missing-course';
    if (reference === 'manager') input.people.employees[0].manager_id = 'missing-manager';
    if (reference === 'skill') input.people.employees[0].skills = { missing: 1 };
    if (reference === 'role') input.people.employees[0].role = 'Missing Role';
    if (reference === 'goal') input.people.employees[0].career_goal = { target_role: 'Researcher', target_grade: 'Lead' };
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('resolves a newly imported manager and employee in the same union', async () => {
    const snapshot = await load();
    const additions = [employee({ employee_id: 'new-person', manager_id: 'new-manager' }), employee({ employee_id: 'new-manager' })];
    const additionsHistory = [history({ record_id: 'new-attempt', employee_id: 'new-person' })];
    const union = { ...snapshot, employees: [...snapshot.employees, ...additions], history: [...snapshot.history, ...additionsHistory] };
    expect(validateRelations(union, additions, additionsHistory)).toEqual([]);
  });

  it('reports each future employee date on the correct field', async () => {
    const snapshot = await load();
    const invalid = employee({ hire_date: '2028-06-16', last_review_date: '2028-06-17' });
    expect(validateRelations(snapshot, [invalid], []).map(issue => issue.field)).toEqual(['hire_date', 'last_review_date']);
  });

  it('rejects future history while retaining a future mandatory deadline', async () => {
    const snapshot = await load();
    snapshot.events[0].mandatory = true;
    const pending = history({ due_date: '2028-07-01' });
    expect(validateRelations(snapshot, [], [pending])).toEqual([]);
    expect(validateRelations(snapshot, [], [{ ...pending, date: '2028-06-16' }])).toMatchObject([{ field: 'date' }]);
  });
});

describe('completion and session invariants', () => {
  it('rejects the documented repeatable club when its format has no session date', async () => {
    const input = files();
    input.activities.events[0].event_id = 'EV_036';
    input.history[0].event_id = 'EV_036';
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['online', 'offline'] as const)('allows distinct %s club sessions but rejects duplicate session completion', async format => {
    const input = files();
    input.activities.events[0] = event({ event_id: 'EV_036', format, upcoming_sessions: ['2028-07-01'] });
    input.history = [history({ record_id: 'first-session', event_id: 'EV_036', status: 'completed', completion_pct: 100 }),
      history({ record_id: 'second-session', event_id: 'EV_036', date: '2028-06-01', status: 'completed', completion_pct: 100 })];
    expect((await load(input)).events[0].repeatable).toBe(true);
    input.history[1].date = input.history[0].date;
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects repeated voluntary completions while retaining repeated mandatory assignments', async () => {
    const input = files();
    input.history = [history({ record_id: 'first', status: 'completed', completion_pct: 100 }),
      history({ record_id: 'second', date: '2028-06-01', status: 'completed', completion_pct: 100 })];
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    input.activities.events[0].mandatory = true;
    expect((await load(input)).history).toHaveLength(2);
  });

  it('rejects scheduled sessions and no_show for self-paced activities', async () => {
    const input = files();
    input.activities.events[0].upcoming_sessions = ['2028-07-01'];
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    input.activities.events[0].upcoming_sessions = [];
    input.history[0] = history({ status: 'no_show', completion_pct: 0 });
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('malformed import boundaries', () => {
  it('accepts BOM, reordered CSV columns and quoted identifiers without changing their values', () => {
    const row = history({ record_id: 'synthetic,"quoted"\nidentifier' });
    const encoded = csv([row]).trimEnd().split('\n');
    expect(parseHistoryCsv(`\uFEFF${encoded.join('\n')}\n`)).toEqual([row]);
    const reversed = [...columns].reverse();
    const simpleRow = history();
    const reordered = `${reversed.join(',')}\n${reversed.map(column => simpleRow[column] ?? '').join(',')}\n`;
    expect(parseHistoryCsv(reordered)).toEqual([simpleRow]);
  });

  it.each([
    'record_id,bad\nrecord,value\n',
    `${columns.join(',')},record_id\n`,
    `${columns.join(',')}\n`,
    `${columns.join(',')}\nshort,row\n`,
    `${columns.join(',')}\n"unclosed\n`,
  ])('rejects malformed or empty CSV (%#)', text => {
    expect(() => parseHistoryCsv(text)).toThrow(AppError);
  });

  it.each(['NaN', 'Infinity', '-1', '0x10', '1e2', '100.5', '101', ''])('rejects invalid completion progress %s with a source row', value => {
    const text = `${columns.join(',')}\nsynthetic-attempt,synthetic-person,synthetic-course,2028-05-01,,completed,${value},,,self\n`;
    expect(() => parseHistoryCsv(text)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR', details: expect.objectContaining({ row: 2 }) }));
  });

  it.each(['2028-02-30', '2027-02-29', '2028-6-01', '2028-13-01'])('rejects invalid calendar date %s', date => {
    expect(() => checked(dateSchema, date)).toThrow(AppError);
  });

  it('checks employee metadata and preserves canonical hashing after normalization', () => {
    const input = files().people;
    const first = parseEmployeeFile(`\uFEFF${JSON.stringify(input)}`, meta.as_of_date);
    const second = parseEmployeeFile(JSON.stringify({ ...input, employees: [employee({ employee_id: ' synthetic-person ' })] }), meta.as_of_date);
    expect(sourceHash(first)).toBe(sourceHash(second));
    expect(() => parseEmployeeFile(JSON.stringify(input), '2028-06-16')).toThrow(AppError);
    expect(() => parseJson('{')).toThrow(AppError);
    expect(() => checked(employeeSchema, { ...employee(), extra: true })).toThrow(AppError);
  });

  it.each(['\u0000', '\ud800', '\udfff'])('rejects text that PostgreSQL JSONB cannot store (%#)', invalid => {
    for (const patch of [{ employee_id: `person${invalid}` }, { full_name: `Person${invalid}` }, { skills: { [`skill${invalid}`]: 1 } }]) {
      expect(() => checked(employeeSchema, employee(patch))).toThrow(AppError);
    }
    expect(() => parseHistoryCsv(csv([history({ record_id: `attempt${invalid}` })]))).toThrow(AppError);
  });

  it('rejects NUL inside free-form catalog descriptions before seeding', async () => {
    const input = files();
    input.catalog.skills[0].description = 'invalid\u0000description';
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    input.catalog.skills[0].description = 'Valid description';
    input.activities.events[0].description = 'invalid\u0000description';
    await expect(load(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('preserves legitimate Unicode identifiers and human text', async () => {
    const input = files();
    input.people.employees[0] = employee({ employee_id: 'адам🙂', full_name: 'Жаңа қызметкер 🙂' });
    input.history[0].employee_id = 'адам🙂';
    expect((await load(input)).employees[0]).toMatchObject({ employee_id: 'адам🙂', full_name: 'Жаңа қызметкер 🙂' });
  });
});
