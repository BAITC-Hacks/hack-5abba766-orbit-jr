import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, baselineRanking, cardsFromRanking, rankCandidates, validateRanking } from '../src/ai';
import { SYSTEM_PROMPT } from '../src/ai/prompt';
import { recommendations } from '../src/services/recommendations';
import type { AiRankingInput, Candidate, DatasetSnapshot, EmployeeView, RecommendationFact } from '../src/types';

const mocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(), readSnapshotWithClient: vi.fn(), getCandidates: vi.fn(),
  connect: vi.fn(), query: vi.fn(), release: vi.fn(), fetch: vi.fn(), run: vi.fn(),
}));
vi.mock('../src/db', () => ({ recommendationLockPool: { connect: mocks.connect }, readSnapshotWithClient: mocks.readSnapshotWithClient }));
vi.mock('../src/services/data', () => ({ readSnapshot: mocks.readSnapshot }));
vi.mock('../src/domain', () => ({ getCandidates: mocks.getCandidates }));
// Admission/cache behavior is covered separately; these tests isolate the DB protocol.
vi.mock('../src/services/recommendation-work', () => ({ recommendationWork: { run: mocks.run } }));

function candidate(id: string): Candidate {
  const categories: RecommendationFact['category'][] = ['grade', 'skill_gap', 'history', 'target_requirement', 'eligibility', 'effort'];
  return {
    candidate_id: id, event_id: `event-${id}`, title: `Synthetic ${id}`, event_type: 'course', format: 'self_paced',
    duration_hours: ['first', 'second', 'third', 'fourth'].indexOf(id) + 1 || 4, action: 'start', participation_id: null, session_date: null, relevance: 'direct',
    expected_skill_changes: [{ skill_id: 'A', before: 1, after: 2, gain: 1 }], goal_coverage_delta: 0.25, unlocks_event_ids: [],
    facts: categories.map(category => ({ fact_id: `${id}:${category}`, category, text: `Verified synthetic ${category}` })),
  };
}

function employee(): EmployeeView {
  return {
    version: { dataset_revision: 1, employee_revision: 0 }, employee_id: 'employee', full_name: 'Must not be sent to provider',
    department: 'Engineering', role: 'Engineer', grade: 'Junior', work_format: 'remote', tenure_months: 12, preferred_language: 'ru',
    last_review_date: '2026-09-01', goal: { source: 'imported', target: { target_role: 'Engineer', target_grade: 'Middle' } },
    progress: { coverage: 0.25, gap_points: 3, missing_critical_skill_ids: ['A'] },
    skills: [{ skill_id: 'A', baseline_level: 1, current_level: 1, required_level: 4, gap: 3, critical: true }],
    history: [], has_simulated_progress: false,
  };
}

function input(): AiRankingInput {
  const e = employee();
  const { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills } = e;
  return { version: e.version, as_of_date: '2026-10-01', limit: 3,
    profile: { role, grade, work_format, tenure_months, preferred_language, goal, progress, skills },
    candidates: ['first', 'second', 'third', 'fourth'].map(candidate) };
}

function choice(id = 'first', alternative?: string | null) {
  return { candidate_id: id, reason_fact_ids: [`${id}:grade`, `${id}:skill_gap`, `${id}:history`],
    ...(alternative === undefined ? {} : { alternative_candidate_id: alternative }) };
}

const providerResponse = (output: unknown = { choices: [choice()] }) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { status: 200 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockImplementation((_key: string, operation: () => Promise<unknown>) => operation());
  vi.stubEnv('LLM_API_KEY', 'synthetic-test-key-not-a-secret');
  vi.stubEnv('LLM_MODEL', 'synthetic-test-model');
  vi.stubEnv('LLM_TIMEOUT_MS', '8000');
  vi.stubEnv('LLM_API_URL', 'https://provider.invalid/test');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue(providerResponse());
  const snapshot = { as_of_date: '2026-10-01', dataset_revision: 1, employee_revisions: { employee: 0 } } as unknown as DatasetSnapshot;
  mocks.readSnapshot.mockResolvedValue(snapshot);
  mocks.readSnapshotWithClient.mockResolvedValue(snapshot);
  mocks.getCandidates.mockReturnValue({ employee: employee(), candidates: input().candidates, emptyReason: null, signals: { similarFormatPenalty: new Map(input().candidates.map(c => [c.candidate_id, 0])), unlockedWeightedGain: new Map(input().candidates.map(c => [c.candidate_id, 0])), negativeOutcomes: new Map(input().candidates.map(c => [c.candidate_id, 0])) } });
  mocks.query.mockResolvedValue({ rows: [{ acquired: true }] });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('semantic ranking validation', () => {
  it('accepts grounded choices and an unselected alternative; normalizes provider null', () => {
    expect(validateRanking({ choices: [choice('second', 'fourth'), choice('first', null)] }, input())).toEqual({ choices: [choice('second', 'fourth'), choice('first')] });
  });

  it.each([
    ['invented candidate', { choices: [choice('invented')] }],
    ['invented fact', { choices: [{ ...choice(), reason_fact_ids: ['first:grade', 'first:skill_gap', 'invented'] }] }],
    ['another candidate fact', { choices: [{ ...choice(), reason_fact_ids: ['first:grade', 'first:skill_gap', 'second:history'] }] }],
    ['duplicate choices', { choices: [choice(), choice()] }],
    ['duplicate facts', { choices: [{ ...choice(), reason_fact_ids: ['first:grade', 'first:grade', 'first:history'] }] }],
    ['insufficient qualifying categories', { choices: [{ ...choice(), reason_fact_ids: ['first:grade', 'first:eligibility', 'first:effort'] }] }],
    ['invented alternative', { choices: [choice('first', 'invented')] }],
    ['self alternative', { choices: [choice('first', 'first')] }],
    ['selected alternative', { choices: [choice('first', 'second'), choice('second')] }],
    ['empty choices', { choices: [] }],
    ['unvalidated model prose', { choices: [{ ...choice(), explanation: 'Invented scientific claim' }] }],
  ])('rejects %s', (_label, output) => {
    expect(() => validateRanking(output, input())).toThrow(AiError);
    expect(() => validateRanking(output, input())).toThrow('invalid_response');
  });

  it('enforces the requested limit even when the schema allows up to three', () => {
    expect(() => validateRanking({ choices: [choice('first'), choice('second')] }, { ...input(), limit: 1 })).toThrow('invalid_response');
  });

  it('uses deterministic candidate order for fallback and preserves server-calculated effects', () => {
    const i = input();
    const baseline = baselineRanking({ ...i, limit: 2 });
    expect(baseline.choices.map(item => item.candidate_id)).toEqual(['first', 'second']);
    expect(validateRanking(baseline, { ...i, limit: 2 })).toEqual(baseline);
    const cards = cardsFromRanking(validateRanking({ choices: [choice('second', 'fourth')] }, i), i.candidates);
    expect(cards[0]).toMatchObject({ rank: 1, candidate_id: 'second', expected_skill_changes: i.candidates[1].expected_skill_changes,
      goal_coverage_delta: i.candidates[1].goal_coverage_delta, alternative_candidate_id: 'fourth', alternative: { candidate_id: 'fourth', facts: i.candidates[3].facts } });
  });
});

describe('provider adapter without network calls', () => {
  it('returns a validated provider ranking using only provided factual choices', async () => {
    await expect(rankCandidates(input())).resolves.toEqual({ choices: [choice()] });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const request = mocks.fetch.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(request.body as string);
    expect(payload.store).toBe(false);
    expect(payload.response_format.type).toBe('json_schema');
    expect(payload.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(payload.messages[1].content).not.toContain(employee().full_name);
  });

  it('does not call a provider when no API key is configured', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'missing_api_key' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes provider HTTP failures and invalid model content', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'provider_error' });
    mocks.fetch.mockResolvedValueOnce(providerResponse({ choices: [choice('invented')] }));
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'invalid_response' });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }), { status: 200 }));
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'invalid_response' });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'Refused', content: null } }] }), { status: 200 }));
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('aborts a slow provider within the configured bounded budget', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '100');
    mocks.fetch.mockImplementation((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await expect(rankCandidates(input())).rejects.toMatchObject({ reason: 'provider_timeout' });
  });
});

describe('recommendation service modes and version boundaries', () => {
  const version = { dataset_revision: 1, employee_revision: 0 };

  it('uses a stable opaque cache key without exposing credentials or profile contents', async () => {
    const first = await recommendations('employee', { expected_version: version });
    const key = mocks.run.mock.lastCall![0] as string;
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    for (const raw of [process.env.LLM_API_KEY!, employee().full_name, employee().role, 'employee', 'event-first']) {
      expect(key).not.toContain(raw);
    }
    mocks.run.mockResolvedValue(first);
    await recommendations('employee', { expected_version: version });
    expect(mocks.run.mock.lastCall![0]).toBe(key);
  });

  it('invalidates cache identity when provider configuration, employee, evidence, ranking signals, limit or either revision changes', async () => {
    const first = await recommendations('employee', { expected_version: version });
    const originalKey = mocks.run.mock.lastCall![0] as string;
    const originalDomain = mocks.getCandidates.mock.results.at(-1)!.value;
    mocks.run.mockResolvedValue(first); // Inspect service keys independently of the DB protocol.
    const expectNewKey = async (id = 'employee', expectedVersion = version, limit?: 1 | 2 | 3) => {
      await recommendations(id, { expected_version: expectedVersion, ...(limit ? { limit } : {}) });
      expect(mocks.run.mock.lastCall![0]).not.toBe(originalKey);
    };
    for (const [name, changed] of [
      ['LLM_MODEL', 'other-model'], ['LLM_API_URL', 'https://other-provider.invalid/test'],
      ['LLM_API_KEY', 'rotated-synthetic-key'], ['LLM_TIMEOUT_MS', '1000'],
    ] as const) {
      const original = process.env[name];
      vi.stubEnv(name, changed);
      await expectNewKey();
      vi.stubEnv(name, original);
    }
    await expectNewKey('employee', version, 1);
    mocks.getCandidates.mockReturnValue({ ...originalDomain, employee: { ...originalDomain.employee, employee_id: 'judge/new-person' } });
    await expectNewKey('judge/new-person');
    const changedEvidence = structuredClone(originalDomain);
    changedEvidence.candidates[0].facts[0].text = 'Updated verified evidence from the current snapshot';
    mocks.getCandidates.mockReturnValue(changedEvidence);
    await expectNewKey();
    for (const signalName of ['negativeOutcomes', 'similarFormatPenalty', 'unlockedWeightedGain'] as const) {
      const changedSignals = structuredClone(originalDomain);
      changedSignals.signals[signalName].set(changedSignals.candidates[0].candidate_id, 1);
      mocks.getCandidates.mockReturnValue(changedSignals);
      await expectNewKey();
    }
    for (const updatedVersion of [{ ...version, dataset_revision: 2 }, { ...version, employee_revision: 1 }]) {
      mocks.getCandidates.mockReturnValue({ ...originalDomain, employee: { ...originalDomain.employee, version: updatedVersion } });
      mocks.readSnapshot.mockResolvedValue({ as_of_date: '2026-10-01', dataset_revision: updatedVersion.dataset_revision, employee_revisions: { employee: updatedVersion.employee_revision } });
      await expectNewKey('employee', updatedVersion);
    }
  });

  it('reuses actual cached AI work while fresh version checks and post-provider staleness still reject', async () => {
    const { RecommendationWork } = await vi.importActual<typeof import('../src/services/recommendation-work')>('../src/services/recommendation-work');
    const work = new RecommendationWork();
    mocks.run.mockImplementation((key: string, operation: Parameters<typeof work.run>[1], options: Parameters<typeof work.run>[2]) => work.run(key, operation, options));
    // A fresh Response is needed for each real adapter invocation because its body is consumed once.
    mocks.fetch.mockImplementation(async () => providerResponse());
    const first = await recommendations('employee', { expected_version: version });
    expect(first.mode).toBe('ai');
    expect(await recommendations('employee', { expected_version: version })).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.readSnapshot).toHaveBeenCalledTimes(2);

    const updatedVersion = { ...version, employee_revision: 1 };
    const originalDomain = mocks.getCandidates.mock.results.at(-1)!.value;
    mocks.getCandidates.mockReturnValue({ ...originalDomain, employee: { ...originalDomain.employee, version: updatedVersion } });
    const updatedSnapshot = { as_of_date: '2026-10-01', dataset_revision: 1, employee_revisions: { employee: 1 } };
    mocks.readSnapshot.mockResolvedValue(updatedSnapshot);
    await expect(recommendations('employee', { expected_version: version })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(mocks.fetch).toHaveBeenCalledOnce();

    mocks.readSnapshotWithClient.mockResolvedValue({ ...updatedSnapshot, employee_revisions: { employee: 2 } });
    await expect(recommendations('employee', { expected_version: updatedVersion })).rejects.toMatchObject({ code: 'STALE_RECOMMENDATION' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
    // A discarded stale result is not cached; recovery performs a new provider request.
    mocks.readSnapshotWithClient.mockResolvedValue(updatedSnapshot);
    await expect(recommendations('employee', { expected_version: updatedVersion })).resolves.toMatchObject({ mode: 'ai', version: updatedVersion });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.release).toHaveBeenCalledTimes(3);
  });

  it('returns explicit rules_fallback with no key while keeping grounded facts', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    const result = await recommendations('employee', { expected_version: version, limit: 2 });
    expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'missing_api_key', empty_reason: null });
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations.map(card => card.event_id)).toEqual(['event-first', 'event-second']);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('returns provider_error fallback for a failed provider, rather than a failed page', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Simulated offline provider'));
    await expect(recommendations('employee', { expected_version: version })).resolves.toMatchObject({ mode: 'rules_fallback', fallback_reason: 'provider_error' });
  });

  it('returns invalid_response fallback when the model invents an event', async () => {
    mocks.fetch.mockResolvedValue(providerResponse({ choices: [choice('invented')] }));
    await expect(recommendations('employee', { expected_version: version })).resolves.toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' });
  });

  it('returns AI mode only after semantic validation and never exposes model prose', async () => {
    const result = await recommendations('employee', { expected_version: version });
    expect(result).toMatchObject({ mode: 'ai', fallback_reason: null, empty_reason: null });
    expect(result.recommendations[0].facts).toEqual(candidate('first').facts);
    expect(result.recommendations[0].expected_skill_changes).toEqual(candidate('first').expected_skill_changes);
  });

  it('does not acquire a connection or call the provider for an empty candidate set', async () => {
    mocks.getCandidates.mockReturnValue({ employee: employee(), candidates: [], emptyReason: 'GOAL_REQUIRED', signals: { unlockedWeightedGain: new Map(), negativeOutcomes: new Map(), similarFormatPenalty: new Map() } });
    await expect(recommendations('employee', { expected_version: version })).resolves.toEqual({ version, mode: 'no_candidates', empty_reason: 'GOAL_REQUIRED', recommendations: [], fallback_reason: null });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects stale incoming versions before starting provider work', async () => {
    await expect(recommendations('employee', { expected_version: { ...version, employee_revision: 2 } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a changed version after provider completion instead of returning stale AI or fallback', async () => {
    const changed = { dataset_revision: 1, employee_revisions: { employee: 1 } };
    mocks.readSnapshot.mockResolvedValueOnce({ dataset_revision: 1, as_of_date: '2026-10-01', employee_revisions: { employee: 0 } }).mockResolvedValue(changed);
    mocks.readSnapshotWithClient.mockResolvedValue(changed);
    await expect(recommendations('employee', { expected_version: version })).rejects.toMatchObject({ code: 'STALE_RECOMMENDATION' });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects simultaneous work for the same version and releases the admission connection', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    await expect(recommendations('employee', { expected_version: version })).rejects.toMatchObject({ code: 'RECOMMENDATION_IN_PROGRESS' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('reports bounded admission exhaustion without making a provider call', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('Synthetic connection queue timeout'));
    await expect(recommendations('employee', { expected_version: version })).rejects.toMatchObject({ code: 'STORAGE_BUSY', status: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('aborts provider work and releases the advisory lock when the caller cancels', async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal!.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')), { once: true });
    }));
    const pending = recommendations('employee', { expected_version: version }, controller.signal);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.run.mock.lastCall![2]).toEqual({ sharePending: false });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ mode: 'rules_fallback', fallback_reason: 'provider_timeout' });
    expect((mocks.fetch.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
    expect(mocks.query.mock.calls.at(-1)![0]).toBe('SELECT pg_advisory_unlock(hashtextextended($1,0))');
    expect(mocks.release).toHaveBeenCalledWith(undefined);
  });

  it('holds no transaction during AI and reuses its existing connection for the final snapshot', async () => {
    let resolveProvider!: (response: Response) => void;
    mocks.fetch.mockReturnValue(new Promise<Response>(resolve => { resolveProvider = resolve; }));
    const pending = recommendations('employee', { expected_version: version });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.run.mock.lastCall![2]).toEqual({ sharePending: true });
    expect(mocks.query.mock.calls.map(call => call[0])).toEqual(['SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired']);
    resolveProvider(providerResponse());
    await expect(pending).resolves.toMatchObject({ mode: 'ai' });
    expect(mocks.readSnapshot).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.readSnapshotWithClient).toHaveBeenCalledWith({ query: mocks.query, release: mocks.release });
    expect(mocks.query.mock.calls.map(call => call[0])).toEqual([
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT',
      'SELECT pg_advisory_unlock(hashtextextended($1,0))',
    ]);
  });

  it('rolls back a failed final snapshot and still releases its advisory lock', async () => {
    const failure = new Error('Synthetic snapshot read failed');
    mocks.readSnapshotWithClient.mockRejectedValue(failure);
    await expect(recommendations('employee', { expected_version: version })).rejects.toBe(failure);
    expect(mocks.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    expect(mocks.query.mock.calls.at(-1)![0]).toBe('SELECT pg_advisory_unlock(hashtextextended($1,0))');
    expect(mocks.release).toHaveBeenCalledWith(undefined);
  });

  it('destroys a connection whose advisory unlock failed instead of returning a locked session to the pool', async () => {
    const failure = new Error('Synthetic unlock failed');
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) throw failure;
      return { rows: [{ acquired: true }] };
    });
    await expect(recommendations('employee', { expected_version: version })).resolves.toMatchObject({ mode: 'ai' });
    expect(mocks.release).toHaveBeenCalledWith(failure);
  });
});
