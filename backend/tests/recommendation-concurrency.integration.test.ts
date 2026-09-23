import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { AiRankingInput, EmployeeSource } from '../src/types';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('recommendation concurrency on isolated PostgreSQL', () => {
  const schema = `recommend_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let db: typeof import('../src/db');
  let handle: typeof import('../src/http')['handleRequest'];
  let recommend: typeof import('../src/services/recommendations')['recommendations'];
  let directory: string;
  let cookie: string;
  const providerResponses: (() => void)[] = [];
  const people: EmployeeSource[] = Array.from({ length: 10 }, (_, index) => ({
    employee_id: `PERSON_${index}`, full_name: `Synthetic person ${index}`, department: 'Engineering',
    role: 'Engineer', grade: 'Junior', manager_id: null, hire_date: '2025-01-01', tenure_months: 21,
    work_format: 'remote', preferred_language: 'ru', career_goal: { target_role: 'Engineer', target_grade: 'Middle' },
    skills: { CODING: 1 }, last_review_date: '2026-09-01',
  }));
  const version = { dataset_revision: 1, employee_revision: 1 };

  const call = (route: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => handle(new Request(`http://localhost:3000${route}`, {
    method: options.method ?? 'GET', signal: options.signal,
    headers: { cookie: cookie ?? '', origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  }));

  function delayedProvider() {
    vi.stubEnv('LLM_API_KEY', 'synthetic-local-test-key');
    vi.stubEnv('LLM_MODEL', 'synthetic-local-test-model');
    vi.stubEnv('LLM_TIMEOUT_MS', '8000');
    vi.stubEnv('LLM_API_URL', 'https://provider.invalid/concurrency-test');
    const fetch = vi.fn((_url: string, request: RequestInit) => new Promise<Response>((resolve, reject) => {
      const payload = JSON.parse(request.body as string);
      const input = JSON.parse(payload.messages[1].content) as AiRankingInput;
      const candidate = input.candidates[0];
      const complete = () => {
        request.signal?.removeEventListener('abort', abort);
        resolve(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ choices: [{
          candidate_id: candidate.candidate_id,
          reason_fact_ids: candidate.facts.filter(fact => ['grade', 'skill_gap', 'history'].includes(fact.category)).map(fact => fact.fact_id),
          alternative_candidate_id: null,
        }] }) } }] }));
      };
      const abort = () => reject(new DOMException('Synthetic caller cancellation', 'AbortError'));
      request.signal?.addEventListener('abort', abort, { once: true });
      providerResponses.push(complete);
    }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl!);
    vi.stubEnv('DATABASE_SCHEMA', schema);
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('DEMO_EMPLOYEE_PASSWORD', 'synthetic-employee-2026');
    vi.stubEnv('DEMO_HR_PASSWORD', 'synthetic-hr-2026');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    directory = await mkdtemp(path.join(tmpdir(), 'cq-concurrency-'));
    const meta = { dataset: 'Authored concurrency test', version: '1', as_of_date: '2026-10-01' };
    const files = {
      'employees.json': { meta, employees: people },
      'skills.json': { meta, proficiency_scale: Object.fromEntries([0, 1, 2, 3, 4, 5].map(n => [String(n), `Level ${n}`])),
        skills: [{ skill_id: 'CODING', name: 'Coding', type: 'hard', category: 'engineering', description: 'Coding' }],
        role_profiles: ['Junior', 'Middle'].map(grade => ({ role: 'Engineer', grade, required_skills: { CODING: grade === 'Junior' ? 1 : 3 }, critical_skills: ['CODING'] })) },
      'events.json': { meta, events: [{ event_id: 'COURSE', title: 'Coding practice', description: 'Authored test course', type: 'course', format: 'self_paced', duration_hours: 3, mandatory: false,
        target_roles: ['Engineer'], target_grades: ['Junior'], prerequisites: {}, develops_skills: [{ skill_id: 'CODING', gain: 1, max_level: 5 }], upcoming_sessions: [] }] },
    };
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(directory, name), JSON.stringify(value));
    await writeFile(path.join(directory, 'activity_history.csv'), 'record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nH1,PERSON_0,COURSE,2026-08-01,,declined,0,,,self\n');
    db = await import('../src/db');
    await (await import('../src/db/bootstrap')).bootstrapDatabase(directory);
    handle = (await import('../src/http')).handleRequest;
    recommend = (await import('../src/services/recommendations')).recommendations;
    const signed = await call('/api/auth/login', { method: 'POST', body: { username: 'hr', password: 'synthetic-hr-2026' } });
    expect(signed.status).toBe(200);
    cookie = signed.headers.get('set-cookie')!.split(';')[0];
  }, 30000);

  afterEach(() => {
    providerResponses.splice(0).forEach(complete => complete());
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    if (db) await db.closePools();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (directory) await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('keeps profile GET below two seconds while ten provider calls remain pending', async () => {
    const fetch = delayedProvider();
    const pending = people.map(person => recommend(person.employee_id, { expected_version: version }));
    let profile: Promise<Response> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(10), { timeout: 6000, interval: 10 });
      const started = performance.now();
      profile = call('/api/employees/PERSON_0');
      const result = await Promise.race([
        profile.then(response => ({ status: response.status, elapsedMs: performance.now() - started })),
        new Promise<{ status: string; elapsedMs: number }>(resolve => { deadline = setTimeout(() => resolve({ status: 'blocked-by-pending-AI', elapsedMs: performance.now() - started }), 1800); }),
      ]);
      expect(result, JSON.stringify(result)).toMatchObject({ status: 200 });
      expect(result.elapsedMs).toBeLessThan(2000);
      console.info(JSON.stringify({ activeProviderCalls: 10, profileLatencyMs: Math.round(result.elapsedMs) }));
    } finally {
      if (deadline) clearTimeout(deadline);
      providerResponses.splice(0).forEach(complete => complete());
      await Promise.allSettled(pending);
      await profile;
    }
  }, 15000);

  it('propagates HTTP cancellation to the provider and releases the database lock', async () => {
    const fetch = delayedProvider();
    const controller = new AbortController();
    const pending = call('/api/employees/PERSON_0/recommendations', {
      method: 'POST', body: { expected_version: version }, signal: controller.signal,
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const observer = await admin.connect();
    const lockName = 'recommend:PERSON_0:1:1';
    let acquired = false;
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce(), { timeout: 3000 });
      expect((await observer.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockName])).rows[0].acquired).toBe(false);
      const started = performance.now();
      controller.abort();
      const response = await Promise.race([
        pending,
        new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 1200); }),
      ]);
      expect(response, 'Cancelled HTTP work should release before the eight-second provider deadline').not.toBeNull();
      expect(response!.status).toBe(200);
      expect((await response!.json()).data).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'provider_timeout' });
      expect((fetch.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
      acquired = Boolean((await observer.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockName])).rows[0].acquired);
      expect(acquired, 'Another connection must be able to acquire the same lock after cancellation').toBe(true);
      console.info(JSON.stringify({ cancelledRequestReleaseMs: Math.round(performance.now() - started) }));
    } finally {
      if (deadline) clearTimeout(deadline);
      providerResponses.splice(0).forEach(complete => complete());
      await pending;
      if (acquired) await observer.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockName]);
      observer.release();
    }
  }, 15000);
});
