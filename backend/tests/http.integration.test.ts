import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { EmployeeSource, EmployeeView, RecommendationResult } from '../src/types';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('HTTP: isolated PostgreSQL end-to-end', () => {
  const schema = `http_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let handle: (request: Request) => Promise<Response>;
  let appPool: pg.Pool;
  let directory: string;
  const meta = { dataset: 'Authored HTTP integration fixture', version: '1', as_of_date: '2026-10-01' };
  const employee: EmployeeSource = { employee_id: 'PERSON_A', full_name: 'Test Person', department: 'Engineering', role: 'Engineer', grade: 'Junior', manager_id: null, hire_date: '2025-01-01', tenure_months: 21, work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Engineer', target_grade: 'Middle' }, skills: { CODING: 1 }, last_review_date: '2026-09-01' };
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_SCHEMA = schema;
    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.LLM_API_KEY = ''; process.env.LLM_MODEL = '';
    process.env.DEMO_EMPLOYEE_PASSWORD = 'employee-demo-2026'; process.env.DEMO_HR_PASSWORD = 'hr-demo-2026';
    await admin.query(`CREATE SCHEMA "${schema}"`);
    directory = await mkdtemp(path.join(tmpdir(), 'cq-http-'));
    const events = [
      { event_id: 'COURSE', title: 'Practical coding', description: 'Practice', type: 'course', format: 'self_paced', duration_hours: 3, mandatory: false, target_roles: ['Engineer'], target_grades: ['Junior', 'Middle'], prerequisites: {}, develops_skills: [{ skill_id: 'CODING', gain: 1, max_level: 5 }], upcoming_sessions: [] },
      { event_id: 'POLICY', title: 'Policy', description: 'Policy', type: 'compliance', format: 'self_paced', duration_hours: 1, mandatory: true, target_roles: ['Engineer'], target_grades: ['Junior'], prerequisites: {}, develops_skills: [], upcoming_sessions: [] },
    ];
    const files: Record<string, unknown> = {
      'employees.json': { meta, employees: [employee, { ...employee, employee_id: 'PERSON_B' }] },
      'skills.json': { meta, proficiency_scale: Object.fromEntries([0, 1, 2, 3, 4, 5].map(n => [String(n), `Level ${n}`])), skills: [{ skill_id: 'CODING', name: 'Coding', type: 'hard', category: 'engineering', description: 'Coding' }], role_profiles: ['Junior', 'Middle'].map(grade => ({ role: 'Engineer', grade, required_skills: { CODING: grade === 'Junior' ? 1 : 3 }, critical_skills: ['CODING'] })) },
      'events.json': { meta, events },
    };
    for (const [file, value] of Object.entries(files)) await writeFile(path.join(directory, file), JSON.stringify(value));
    await writeFile(path.join(directory, 'activity_history.csv'), 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nH1,PERSON_A,POLICY,2026-08-01,,completed,100,,,hr\n');
    const { bootstrapDatabase } = await import('../src/db/bootstrap');
    await bootstrapDatabase(directory);
    appPool = (await import('../src/db')).pool;
    handle = (await import('../src/http')).handleRequest;
  }, 30000);
  afterAll(async () => {
    if (appPool) await appPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const call = async (route: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string; key?: string } = {}) => {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (options.cookie) headers.cookie = options.cookie;
    if (method !== 'GET') { headers.origin = options.origin ?? 'http://localhost:3000'; headers['Content-Type'] = 'application/json'; }
    if (options.key) headers['Idempotency-Key'] = options.key;
    return handle(new Request(`http://localhost:3000${route}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) }));
  };

  it('enforces sessions, origin and scope; completes once; imports atomically; logout revokes', async () => {
    expect((await call('/api/health')).status).toBe(200);
    expect((await call('/api/employees/PERSON_A')).status).toBe(401);
    expect((await call('/api/auth/login', { method: 'POST', origin: 'https://evil.invalid', body: { username: 'employee', password: 'employee-demo-2026' } })).status).toBe(403);
    expect((await call('/api/auth/login', { method: 'POST', body: { username: 'employee', password: 'wrong' } })).status).toBe(401);
    const signed = await call('/api/auth/login', { method: 'POST', body: { username: 'employee', password: 'employee-demo-2026' } });
    expect(signed.status).toBe(200); expect(signed.headers.get('set-cookie')).toContain('HttpOnly');
    const cookie = signed.headers.get('set-cookie')!.split(';')[0];
    expect((await call('/api/employees/PERSON_B', { cookie })).status).toBe(403);
    expect((await call('/api/hr/overview', { cookie })).status).toBe(403);
    const profile = (await (await call('/api/employees/PERSON_A', { cookie })).json()).data as EmployeeView;
    const recs = (await (await call('/api/employees/PERSON_A/recommendations', { cookie, method: 'POST', body: { expected_version: profile.version } })).json()).data as RecommendationResult;
    expect(recs.mode).toBe('rules_fallback'); expect(recs.recommendations).toHaveLength(1);
    const body = { expected_version: profile.version, simulation: true, target: { kind: 'new_participation', event_id: 'COURSE', session_date: null } };
    const done = await call('/api/employees/PERSON_A/completions', { cookie, method: 'POST', key: 'http-completion-1', body });
    expect(done.status).toBe(200);
    const completed = await done.json(); expect(completed.data.skill_changes[0]).toMatchObject({ before: 1, after: 2, gain: 1 });
    const replay = await call('/api/employees/PERSON_A/completions', { cookie, method: 'POST', key: 'http-completion-1', body });
    const replayed = await replay.json(); expect(replayed.meta.replayed).toBe(true); expect(replayed.data).toEqual(completed.data);
    expect((await call('/api/employees/PERSON_A/goal', { cookie, method: 'PUT', body: { expected_version: profile.version, career_goal: null } })).status).toBe(409);
    const hrSigned = await call('/api/auth/login', { method: 'POST', body: { username: 'hr', password: 'hr-demo-2026' } });
    const hrCookie = hrSigned.headers.get('set-cookie')!.split(';')[0];
    const overview = await (await call('/api/hr/overview', { cookie: hrCookie })).json();
    expect(overview.data.employee_count).toBe(2); expect(overview.data.participation.simulated_completions).toBe(1);
    const importRequest = (dry: boolean, person: EmployeeSource) => {
      const form = new FormData(); form.set('dry_run', String(dry)); form.set('expected_dataset_revision', String(profile.version.dataset_revision));
      form.set('employees', new File([JSON.stringify({ meta, employees: [person] })], 'employees.json', { type: 'application/json' }));
      return new Request('http://localhost:3000/api/import', { method: 'POST', headers: { cookie: hrCookie, origin: 'http://localhost:3000', 'Idempotency-Key': 'http-import-001' }, body: form });
    };
    const person = { ...employee, employee_id: 'JUDGE_NEW' };
    const preview = await (await handle(importRequest(true, person))).json();
    expect(preview.data.applied).toBe(false); expect(preview.data.counts.employees.new_rows).toBe(1);
    const imported = await handle(importRequest(false, person)); expect(imported.status).toBe(200);
    expect((await imported.json()).data.applied).toBe(true);
    const importReplay = await (await handle(importRequest(false, person))).json(); expect(importReplay.meta.replayed).toBe(true);
    expect((await call('/api/employees/JUDGE_NEW', { cookie: hrCookie })).status).toBe(200);
    const malformed = await handle(new Request('http://localhost:3000/api/employees/PERSON_A/goal', { method: 'PUT', headers: { cookie, origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: '{' }));
    expect(malformed.status).toBe(400);
    expect((await handle(new Request('http://localhost:3000/api/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://localhost:3000' } }))).status).toBe(200);
    expect((await call('/api/auth/session', { cookie })).status).toBe(401);
  }, 30000);
});
