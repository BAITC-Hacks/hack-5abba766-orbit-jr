import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type {
  ApiResponse, Candidate, CompletionRequest, CompletionResult, DomainVersion,
  EmployeeView, HrOverview, RecommendationResult,
} from '../src/types';
import { aiFlowMeta as meta, aiFlowPerson as person, writeAiFlowFixture } from './fixtures/ai-flow';

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveRequested = process.env.RUN_LIVE_AI_FLOW === '1';
const liveConfiguration = Object.fromEntries(['LLM_API_KEY', 'LLM_MODEL', 'LLM_API_URL', 'LLM_TIMEOUT_MS'].map(key => [key, process.env[key]]));
const initialVersion = { dataset_revision: 1, employee_revision: 1 };
const observations: Record<string, unknown>[] = [];

// Every table is real PostgreSQL in a new random schema. Only the race test uses a
// local HTTP provider stub; the opt-in live test uses the configured real provider.
describe.skipIf(!databaseUrl)('AI flow: authored fixtures, real PostgreSQL and HTTP handlers', () => {
  const schema = `ai_flow_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  let directory: string;
  let closePools: (() => Promise<void>) | undefined;
  let bootstrap: typeof import('../src/db/bootstrap');
  let handle: (request: Request) => Promise<Response>;
  let cookie: string;
  let hrCookie: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_SCHEMA = schema;
    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.DEMO_EMPLOYEE_PASSWORD = 'employee-ai-fixture';
    process.env.DEMO_HR_PASSWORD = 'hr-ai-fixture';
    directory = await mkdtemp(path.join(tmpdir(), 'orbit-ai-flow-'));
    await writeAiFlowFixture(directory);
    bootstrap = await import('../src/db/bootstrap');
    closePools = (await import('../src/db')).closePools;
    handle = (await import('../src/http')).handleRequest;
  }, 30000);

  const call = (route: string, options: { method?: string; body?: unknown; key?: string; hr?: boolean } = {}) => {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { cookie: options.hr ? hrCookie : cookie };
    if (method !== 'GET') { headers.origin = 'http://localhost:3000'; headers['Content-Type'] = 'application/json'; }
    if (options.key) headers['Idempotency-Key'] = options.key;
    return handle(new Request(`http://localhost:3000${route}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) }));
  };
  async function successful<T>(response: Response): Promise<ApiResponse<T>> {
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body as ApiResponse<T>;
  }
  const recommendations = (version: DomainVersion, id = person.employee_id, hr = false) => call(`/api/employees/${id}/recommendations`, { method: 'POST', body: { expected_version: version, limit: 1 }, hr });
  const complete = (version: DomainVersion, event = 'FLOW_BASIC', key = 'flow-complete-basic') => {
    const body: CompletionRequest = {
      expected_version: version, simulation: true,
      target: event === 'FLOW_BASIC' ? { kind: 'existing_participation', participation_id: 'FLOW_STARTED' } : { kind: 'new_participation', event_id: event, session_date: null },
    };
    return call(`/api/employees/${person.employee_id}/completions`, { method: 'POST', body, key });
  };

  beforeEach(async () => {
    process.env.LLM_API_KEY = ''; process.env.LLM_MODEL = '';
    if (!/^ai_flow_[a-f0-9]+$/.test(schema)) throw new Error('Refusing to reset a non-test schema');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await bootstrap.bootstrapDatabase(directory);
    const login = async (username: string, password: string) => {
      const response = await call('/api/auth/login', { method: 'POST', body: { username, password } });
      await successful(response);
      return response.headers.get('set-cookie')!.split(';')[0];
    };
    cookie = await login('employee', 'employee-ai-fixture');
    hrCookie = await login('hr', 'hr-ai-fixture');
  });

  afterAll(async () => {
    await closePools?.();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (directory) await rm(directory, { recursive: true, force: true });
    if (process.env.AI_FLOW_REPORT_PATH) {
      const output = path.resolve(process.env.AI_FLOW_REPORT_PATH);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify({
        recorded_at: new Date().toISOString(), fixture: meta.dataset, database: 'PostgreSQL with isolated temporary schema',
        boundary: 'Authenticated HTTP Request/Response handlers; browser and app TCP transport excluded',
        live_requested: liveRequested, checks: observations,
      }, null, 2) + '\n');
    }
    for (const [key, value] of Object.entries(liveConfiguration)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  async function lifecycle(mode: 'ai' | 'rules_fallback') {
    const started = performance.now();
    const profile = (await successful<EmployeeView>(await call(`/api/employees/${person.employee_id}`))).data;
    expect(profile.progress?.gap_points).toBe(2);
    const firstStarted = performance.now();
    const first = (await successful<RecommendationResult>(await recommendations(profile.version))).data;
    const firstLatency = Math.round(performance.now() - firstStarted);
    expect(first.mode, JSON.stringify({ mode: first.mode, fallback: first.fallback_reason })).toBe(mode);
    expect(first.recommendations).toHaveLength(1);
    expect(first.recommendations[0]).toMatchObject({ event_id: 'FLOW_BASIC', action: 'continue', unlocks_event_ids: ['FLOW_ADVANCED'] });
    if (mode === 'rules_fallback') expect(first.fallback_reason).toBe('missing_api_key');
    const done = await successful<CompletionResult>(await complete(profile.version));
    expect(done.data.skill_changes).toEqual([{ skill_id: 'SQL', before: 1, after: 2, gain: 1 }]);
    expect(done.data.employee.progress?.gap_points).toBe(1);
    const replay = await successful<CompletionResult>(await complete(profile.version));
    expect(replay.meta.replayed).toBe(true);
    expect(replay.data).toEqual(done.data);
    const stale = await recommendations(profile.version);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('REVISION_CONFLICT');
    const duplicate = await complete(done.data.version, 'FLOW_BASIC', 'flow-duplicate-basic');
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('ALREADY_COMPLETED');
    const nextStarted = performance.now();
    const next = (await successful<RecommendationResult>(await recommendations(done.data.version))).data;
    const nextLatency = Math.round(performance.now() - nextStarted);
    expect(next.mode, JSON.stringify({ mode: next.mode, fallback: next.fallback_reason })).toBe(mode);
    expect(next.version).toEqual(done.data.version);
    expect(next.recommendations).toHaveLength(1);
    expect(next.recommendations[0]).toMatchObject({ event_id: 'FLOW_ADVANCED', action: 'start', expected_skill_changes: [{ skill_id: 'SQL', before: 2, after: 3, gain: 1 }] });
    const last = (await successful<CompletionResult>(await complete(next.version, 'FLOW_ADVANCED', 'flow-complete-advanced'))).data;
    const reached = (await successful<RecommendationResult>(await recommendations(last.version))).data;
    expect(reached).toMatchObject({ mode: 'no_candidates', empty_reason: 'GOAL_REACHED', recommendations: [] });
    const overview = (await successful<HrOverview>(await call('/api/hr/overview', { hr: true }))).data;
    expect(overview.participation).toMatchObject({ simulated_completions: 2, actual_by_status: { in_progress: 1 }, effective_by_status: { completed: 2, in_progress: 0 } });
    expect(overview.skill_gaps[0]).toMatchObject({ total_gap_points: 0, employees_with_gap: 0 });
    expect(overview.no_next_step).toContainEqual(expect.objectContaining({ employee_id: person.employee_id, reason: 'GOAL_REACHED' }));
    observations.push({ check: `${mode}_profile_completion_recommendation_hr`, status: 'passed', recommendation_modes: [first.mode, next.mode, reached.mode], recommendation_latency_ms: [firstLatency, nextLatency], ...(mode === 'ai' ? { model: liveConfiguration.LLM_MODEL } : {}), skills: [1, 2, 3], simulated_completions: 2, duration_ms: Math.round(performance.now() - started) });
  }

  it('recomputes fallback recommendations after completion and imports unseen IDs atomically', async () => {
    await lifecycle('rules_fallback');
    const imported = { ...person, employee_id: 'UNSEEN_JUDGE_PERSON', full_name: 'Synthetic Imported Name' };
    const request = (dryRun: boolean) => {
      const form = new FormData();
      form.set('dry_run', String(dryRun)); form.set('expected_dataset_revision', '1');
      form.set('employees', new File([JSON.stringify({ meta, employees: [imported] })], 'employees.json', { type: 'application/json' }));
      form.set('history', new File(['record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nUNSEEN_RECORD,UNSEEN_JUDGE_PERSON,FLOW_BASIC,2026-09-20,,completed,100,,,self\n'], 'history.csv', { type: 'text/csv' }));
      return new Request('http://localhost:3000/api/import', { method: 'POST', headers: { cookie: hrCookie, origin: 'http://localhost:3000', 'Idempotency-Key': 'flow-import-unseen' }, body: form });
    };
    const preview = await successful<{ applied: boolean }>(await handle(request(true)));
    expect(preview.data.applied).toBe(false);
    const applied = await successful<{ applied: boolean; dataset_revision: number }>(await handle(request(false)));
    expect(applied.data).toMatchObject({ applied: true, dataset_revision: 2, counts: { employees: { new_rows: 1 }, history: { new_rows: 1 } } });
    const replay = await successful(await handle(request(false)));
    expect(replay.meta.replayed).toBe(true); expect(replay.data).toEqual(applied.data);
    const newProfile = (await successful<EmployeeView>(await call(`/api/employees/${imported.employee_id}`, { hr: true }))).data;
    expect(newProfile.skills[0].current_level).toBe(2);
    const result = (await successful<RecommendationResult>(await recommendations(newProfile.version, imported.employee_id, true))).data;
    expect(result.mode).toBe('rules_fallback'); expect(result.recommendations[0].event_id).toBe('FLOW_ADVANCED');
    expect((await call(`/api/employees/${imported.employee_id}`)).status).toBe(403);
    const stale = await recommendations({ dataset_revision: 1, employee_revision: 3 });
    expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe('REVISION_CONFLICT');
    const overview = (await successful<HrOverview>(await call('/api/hr/overview', { hr: true }))).data;
    expect(overview).toMatchObject({ employee_count: 2, participation: { simulated_completions: 2, actual_by_status: { completed: 1 } } });
    observations.push({ check: 'unseen_employee_and_history_import', status: 'passed', dataset_revision: newProfile.version.dataset_revision, recommendations: result.recommendations.map(card => card.event_id) });
  }, 30000);

  it('rejects concurrent and stale inference through a controlled HTTP provider', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const firstRequest = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    let payloadHadPrivateFields = false;
    const server: Server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: { role: string; content: string }[] };
        const message = body.messages.find(item => item.role === 'user')!.content;
        payloadHadPrivateFields ||= message.includes(person.full_name) || message.includes(person.department) || message.includes('employee_id');
        const input = JSON.parse(message) as { candidates: Candidate[] };
        calls++;
        if (calls === 1) { entered(); await blocked; }
        const candidate = input.candidates[0];
        const output = { choices: [{ candidate_id: candidate.candidate_id, reason_fact_ids: candidate.facts.map(fact => fact.fact_id), alternative_candidate_id: null }] };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing provider test address');
    process.env.LLM_API_URL = `http://127.0.0.1:${address.port}/chat/completions`;
    process.env.LLM_API_KEY = 'local-provider-fixture'; process.env.LLM_MODEL = 'local-fixture'; process.env.LLM_TIMEOUT_MS = '8000';
    let pending: Promise<Response> | undefined;
    try {
      pending = recommendations(initialVersion);
      const enteredProvider = await Promise.race([firstRequest.then(() => true), pending.then(() => false)]);
      expect(enteredProvider).toBe(true);
      const concurrent = await recommendations(initialVersion);
      expect(concurrent.status).toBe(429); expect((await concurrent.json()).error.code).toBe('RECOMMENDATION_IN_PROGRESS');
      const done = (await successful<CompletionResult>(await complete(initialVersion))).data;
      release();
      const stale = await pending;
      expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe('STALE_RECOMMENDATION');
      const next = (await successful<RecommendationResult>(await recommendations(done.version))).data;
      expect(next.mode).toBe('ai'); expect(next.recommendations[0].event_id).toBe('FLOW_ADVANCED');
      expect(calls).toBe(2); expect(payloadHadPrivateFields).toBe(false);
      observations.push({ check: 'controlled_provider_concurrency_and_stale_result', status: 'passed', provider: 'local HTTP stub', concurrent_status: 429, stale_status: 409, private_profile_fields_sent: false });
    } finally {
      release(); await pending?.catch(() => undefined);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 30000);

  it.skipIf(!liveRequested)('uses the real LLM before and after completion', async () => {
    expect(liveConfiguration.LLM_API_KEY?.trim(), 'Live flow requires LLM_API_KEY').toBeTruthy();
    expect(liveConfiguration.LLM_MODEL?.trim(), 'Live flow requires LLM_MODEL').toBeTruthy();
    for (const [key, value] of Object.entries(liveConfiguration)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await lifecycle('ai');
  }, 30000);
});
