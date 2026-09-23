import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidate, input } from './fixtures';
import { getModel, getTimeoutMs, isAiConfigured, rankWithModel } from '../../src/ai/adapter';

const fetchMock = vi.fn();
const snapshot = input([candidate({ candidate_id: 'C1' })]);
const response = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LLM_API_KEY', 'synthetic-key');
  vi.stubEnv('LLM_MODEL', 'synthetic-model');
  vi.stubEnv('LLM_API_URL', 'https://provider.invalid/chat/completions');
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('configuration', () => {
  it('reports configured only with both key and explicit model, without a live check', () => {
    vi.stubEnv('LLM_API_KEY', ''); expect(isAiConfigured()).toBe(false);
    vi.stubEnv('LLM_API_KEY', 'synthetic-key'); expect(isAiConfigured()).toBe(true);
    vi.stubEnv('LLM_MODEL', ''); expect(isAiConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires an explicit model and defaults an invalid timeout', () => {
    vi.stubEnv('LLM_MODEL', ''); vi.stubEnv('LLM_TIMEOUT_MS', 'not-a-number');
    expect(getModel()).toBe(''); expect(getTimeoutMs()).toBe(8000);
  });
  it('reads model and timeout from the environment', () => {
    vi.stubEnv('LLM_MODEL', ' configured-model '); vi.stubEnv('LLM_TIMEOUT_MS', '5000');
    expect(getModel()).toBe('configured-model'); expect(getTimeoutMs()).toBe(5000);
  });
  it('caps provider time at eight seconds despite a larger configured value', () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '60000'); expect(getTimeoutMs()).toBe(8000);
  });
});

describe('rankWithModel', () => {
  it('reports missing_api_key without calling the provider', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'missing_api_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not guess a model when none was configured', async () => {
    vi.stubEnv('LLM_MODEL', '');
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'missing_api_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns parsed output while the separate validator remains responsible for semantics', async () => {
    fetchMock.mockResolvedValue(response('{"choices":[{"candidate_id":"C1","reason_fact_ids":["C1-gap"],"alternative_candidate_id":null}]}'));
    const result = await rankWithModel(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toMatchObject({ choices: [{ candidate_id: 'C1' }] });
    expect(fetchMock.mock.calls[0][0]).toBe('https://provider.invalid/chat/completions');
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ store: false, max_completion_tokens: 1400, model: 'synthetic-model' });
  });
  it('maps a provider failure to provider_error without throwing or automatic retries', async () => {
    fetchMock.mockRejectedValue(new Error('503 service unavailable'));
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'provider_error' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('maps non-JSON content to invalid_response', async () => {
    fetchMock.mockResolvedValue(response('sorry, I cannot'));
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
  it('aborts at the configured budget and reports provider_timeout', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '100');
    fetchMock.mockImplementation((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'provider_timeout' });
  });
  it('never calls the provider for an empty candidate set', async () => {
    await rankWithModel(input([])); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('honors an already aborted caller signal before provider work', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await rankWithModel(snapshot, controller.signal)).toMatchObject({ ok: false, reason: 'provider_timeout' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
