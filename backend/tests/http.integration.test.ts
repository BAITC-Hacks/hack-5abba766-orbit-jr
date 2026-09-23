import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
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
  let closePools: typeof import('../src/db')['closePools'];
  let pool: typeof import('../src/db')['pool'];
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
    closePools = (await import('../src/db')).closePools;
    pool = (await import('../src/db')).pool;
    handle = (await import('../src/http')).handleRequest;
  }, 30000);
  afterAll(async () => {
    if (closePools) await closePools();
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
  const signIn = async (username = 'employee') => {
    const response = await call('/api/auth/login', { method: 'POST', body: { username, password: `${username}-demo-2026` } });
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };

  it('avoids company snapshots for static learning, rejected routes and duplicate recommendation reads', async () => {
    const cookie = await signIn();
    const profile = (await (await call('/api/employees/PERSON_A', { cookie })).json()).data as EmployeeView;
    const data = await import('../src/services/data');
    const snapshots = vi.spyOn(data, 'readSnapshot');
    try {
      expect((await call('/api/learning/modules', { cookie })).status).toBe(200);
      expect((await call('/api/unknown', { cookie })).status).toBe(404);
      expect((await call('/api/hr/overview', { cookie })).status).toBe(403);
      expect(snapshots).not.toHaveBeenCalled();
      expect((await call('/api/employees/PERSON_A/recommendations', { cookie, method: 'POST', body: { expected_version: profile.version } })).status).toBe(200);
      expect(snapshots).toHaveBeenCalledTimes(1);
    } finally { snapshots.mockRestore(); }
  });

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

  it('never issues a session or cookie when login cannot read the dataset', async () => {
    const before = await pool.query('SELECT count(*)::int AS count FROM sessions');
    await pool.query('UPDATE app_meta SET seed_complete=false WHERE id=1');
    try {
      const response = await call('/api/auth/login', { method: 'POST', body: { username: 'employee', password: 'employee-demo-2026' } });
      expect(response.status).toBe(503);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows).toEqual(before.rows);
    } finally { await pool.query('UPDATE app_meta SET seed_complete=true WHERE id=1'); }
  });

  it('revokes and clears sessions idempotently even before dataset initialization', async () => {
    const cookie = await signIn();
    const tokenHash = createHash('sha256').update(cookie.slice('cq_session='.length)).digest('hex');
    await pool.query('UPDATE app_meta SET seed_complete=false WHERE id=1');
    try {
      const responses = await Promise.all(Array.from({ length: 3 }, () => call('/api/auth/logout', { method: 'POST', cookie })));
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toContain('cq_session=;');
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
        expect(await response.json()).toMatchObject({ data: { logged_out: true }, meta: { as_of_date: null } });
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash=$1', [tokenHash])).rows[0].count).toBe(0);
    } finally { await pool.query('UPDATE app_meta SET seed_complete=true WHERE id=1'); }
    expect((await call('/api/auth/session', { cookie })).status).toBe(401);
    expect((await call('/api/auth/logout', { method: 'POST', cookie })).status).toBe(200);
  });

  it('rejects expired or malformed tokens and clears expired cookies on logout', async () => {
    const cookie = await signIn();
    const tokenHash = createHash('sha256').update(cookie.slice('cq_session='.length)).digest('hex');
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [tokenHash]);
    expect((await call('/api/auth/session', { cookie })).status).toBe(401);
    for (const invalid of ['cq_session=short', `cq_session=${'!'.repeat(43)}`, `cq_session=${'x'.repeat(43)}`]) {
      expect((await call('/api/auth/session', { cookie: invalid })).status).toBe(401);
    }
    const response = await call('/api/auth/logout', { method: 'POST', cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await pool.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash=$1', [tokenHash])).rows[0].count).toBe(0);
  });

  it('issues separate secure sessions to concurrent clients and revokes only the selected token', async () => {
    const previousOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = 'https://example.test';
    let cookies: string[];
    try {
      const responses = await Promise.all(Array.from({ length: 3 }, () => call('/api/auth/login', {
        method: 'POST', origin: 'https://example.test', body: { username: 'employee', password: 'employee-demo-2026' },
      })));
      cookies = responses.map(response => {
        expect(response.status).toBe(200);
        const setCookie = response.headers.get('set-cookie')!;
        for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200', 'Secure']) expect(setCookie.includes(flag)).toBe(true);
        expect(setCookie.includes('Domain=')).toBe(false);
        return setCookie.split(';')[0];
      });
      expect(new Set(cookies).size).toBe(3);
      const hashes = cookies.map(cookie => createHash('sha256').update(cookie.slice('cq_session='.length)).digest('hex'));
      const stored = await pool.query('SELECT account_id,extract(epoch FROM expires_at-now()) AS ttl FROM sessions WHERE token_hash=ANY($1::text[])', [hashes]);
      expect(stored.rowCount).toBe(3);
      for (const row of stored.rows) {
        expect(row.account_id).toBe('demo-employee');
        expect(Number(row.ttl)).toBeGreaterThan(43100);
        expect(Number(row.ttl)).toBeLessThanOrEqual(43200);
      }
      const logout = await call('/api/auth/logout', { method: 'POST', cookie: cookies[0], origin: 'https://example.test' });
      expect(logout.status).toBe(200);
      expect(logout.headers.get('set-cookie')).toContain('Secure');
    } finally { process.env.APP_ORIGIN = previousOrigin; }
    expect((await call('/api/auth/session', { cookie: cookies![0] })).status).toBe(401);
    for (const cookie of cookies!.slice(1)) {
      const response = await call('/api/auth/session', { cookie });
      expect(response.status).toBe(200);
      expect(Object.keys((await response.json()).data).sort()).toEqual(['account_id', 'display_name', 'employee_id', 'role']);
    }
  });

  it('reports unexpected metadata failures after logout while retaining revocation', async () => {
    const cookie = await signIn();
    const tokenHash = createHash('sha256').update(cookie.slice('cq_session='.length)).digest('hex');
    await pool.query('ALTER TABLE app_meta RENAME TO unavailable_app_meta');
    try {
      const response = await call('/api/auth/logout', { method: 'POST', cookie });
      expect(response.status).toBe(500);
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      expect((await pool.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash=$1', [tokenHash])).rows[0].count).toBe(0);
    } finally { await pool.query('ALTER TABLE unavailable_app_meta RENAME TO app_meta'); }
    expect((await call('/api/auth/session', { cookie })).status).toBe(401);
  });

  it('reads auth and health metadata without loading employee or history tables', async () => {
    await pool.query('ALTER TABLE employees RENAME TO unavailable_employees');
    try {
      const cookie = await signIn();
      const response = await call('/api/auth/session', { cookie });
      expect(response.status).toBe(200);
      expect((await response.json()).meta.as_of_date).toBe(meta.as_of_date);
      const health = await call('/api/health');
      expect(health.status).toBe(200);
      expect((await health.json()).meta.as_of_date).toBe(meta.as_of_date);
      expect((await call('/api/employees/PERSON_A', { cookie })).status).toBe(500);
      expect((await call('/api/auth/logout', { method: 'POST', cookie })).status).toBe(200);
    } finally { await pool.query('ALTER TABLE unavailable_employees RENAME TO employees'); }
  });

  it('applies the origin guard to every mutating route before any side effect', async () => {
    const cookie = await signIn();
    const routes = [
      ['POST', '/api/auth/login'], ['POST', '/api/auth/logout'], ['PUT', '/api/employees/PERSON_A/goal'],
      ['POST', '/api/employees/PERSON_A/recommendations'], ['POST', '/api/employees/PERSON_A/completions'],
      ['POST', '/api/employees/PERSON_A/learning/attempts'], ['POST', '/api/employees/PERSON_A/learning/attempts/unknown/lessons'],
      ['POST', '/api/employees/PERSON_A/learning/attempts/unknown/quiz'], ['POST', '/api/import'],
    ];
    for (const [method, route] of routes) {
      for (const origin of [undefined, 'null', 'https://evil.invalid', 'http://localhost:3000.evil.invalid']) {
        const response = await handle(new Request(`http://localhost:3000${route}`, { method, headers: { cookie, ...(origin ? { origin } : {}) } }));
        expect(response.status, `${method} ${route}, origin=${origin}`).toBe(403);
        expect(response.headers.has('set-cookie')).toBe(false);
      }
    }
    expect((await call('/api/auth/session', { cookie })).status).toBe(200);
    expect((await call('/api/auth/logout', { method: 'POST', cookie, origin: 'http://127.0.0.1:3000' })).status).toBe(200);
  });

  it('keeps foreign learning attempts inaccessible under either employee path', async () => {
    const cookie = await signIn();
    const module = { id: 'HTTP_MODULE', event_id: 'COURSE', title: 'Synthetic module', summary: 'Synthetic fixture', estimated_minutes: 1, version: 1, lessons: [], questions: [], passing_score: 100, sources: [] };
    const target = { kind: 'new_participation', event_id: 'COURSE', session_date: null };
    await pool.query("INSERT INTO learning_attempts(id,employee_id,event_id,module_id,module_version,occurrence_key,target,course_snapshot,created_by) VALUES('LEARN_HTTP_B','PERSON_B','COURSE','HTTP_MODULE',1,'once',$1::jsonb,$2::jsonb,'demo-hr')", [JSON.stringify(target), JSON.stringify(module)]);
    const before = (await pool.query("SELECT status,completed_lesson_ids,quiz_attempts,last_answers FROM learning_attempts WHERE id='LEARN_HTTP_B'")).rows;
    const profile = (await (await call('/api/employees/PERSON_A', { cookie })).json()).data as EmployeeView;
    for (const [employeeId, status] of [['PERSON_A', 404], ['PERSON_B', 403]] as const) {
      const route = `/api/employees/${employeeId}/learning/attempts/LEARN_HTTP_B`;
      expect((await call(route, { cookie })).status).toBe(status);
      expect((await call(`${route}/lessons`, { cookie, method: 'POST', body: { lesson_id: 'intro' } })).status).toBe(status);
      expect((await call(`${route}/quiz`, { cookie, method: 'POST', key: `idor-${employeeId}`, body: { expected_version: profile.version, answers: {} } })).status).toBe(status);
    }
    expect((await pool.query("SELECT status,completed_lesson_ids,quiz_attempts,last_answers FROM learning_attempts WHERE id='LEARN_HTTP_B'")).rows).toEqual(before);
    const hrCookie = await signIn('hr');
    expect((await call('/api/employees/PERSON_B/learning/attempts/LEARN_HTTP_B', { cookie: hrCookie })).status).toBe(200);
  });

  it('rejects malformed text and bounded bodies with safe client errors', async () => {
    const cookie = await signIn();
    const headers = { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' };
    for (const [body, extraHeaders, status] of [
      ['{', {}, 400], [new Uint8Array([0xc3, 0x28]), {}, 400],
      [' '.repeat(64 * 1024 + 1), {}, 413], [' '.repeat(64 * 1024 + 1), { 'content-length': '1' }, 413],
      ['{}', { 'content-length': String(64 * 1024 + 1) }, 413],
    ] as const) {
      const response = await handle(new Request('http://localhost:3000/api/auth/login', { method: 'POST', headers: { ...headers, ...extraHeaders }, body }));
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const error = await response.json();
      expect(error.request_id).toBe(response.headers.get('x-request-id'));
      expect(response.headers.has('set-cookie')).toBe(false);
    }
    for (const suffix of ['%', '%00']) {
      expect((await call(`/api/employees/PERSON_A/learning/attempts/${suffix}`, { cookie })).status).toBe(400);
    }
    for (const username of ['\u0000', '\ud800']) {
      expect((await call('/api/auth/login', { method: 'POST', body: { username, password: 'invalid' } })).status).toBe(400);
    }
    expect((await call('/api/auth/session', { cookie, method: 'POST' })).status).toBe(404);
    expect((await call('/api/employees/PERSON_A/goal', { cookie })).status).toBe(404);
    expect((await call('/api/auth/session', { cookie })).status).toBe(200);
  });

  it('bounds simultaneous password guesses before asynchronous verification', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => call('/api/auth/login', {
      method: 'POST', body: { username: 'missing-concurrent-account', password: 'invalid' },
    })));
    expect(responses.filter(response => response.status === 401)).toHaveLength(10);
    expect(responses.filter(response => response.status === 429)).toHaveLength(2);
    expect(responses.every(response => !response.headers.has('set-cookie'))).toBe(true);
  });
});
