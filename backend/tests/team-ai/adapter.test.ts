import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { candidate, input } from './fixtures';
import { getModel, getTimeoutMs, isAiConfigured, rankWithModel } from '../../src/ai/adapter';

const fetchMock = vi.fn();
const nativeFetch = globalThis.fetch;
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
  it.each(['gpt-6-sol', 'gpt-6-luna'])('uses low reasoning without temperature for %s', async model => {
    vi.stubEnv('LLM_MODEL', model);
    fetchMock.mockResolvedValue(response('{}'));
    await rankWithModel(snapshot);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.reasoning_effort).toBe('low');
    expect(payload).not.toHaveProperty('temperature');
  });
  it.each(['gpt-4o-mini', 'gpt-4.1'])('uses deterministic sampling for %s', async model => {
    vi.stubEnv('LLM_MODEL', model);
    fetchMock.mockResolvedValue(response('{}'));
    await rankWithModel(snapshot);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.temperature).toBe(0);
    expect(payload).not.toHaveProperty('reasoning_effort');
  });
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
  it('closes an unfinished HTTP 503 body before returning fallback without reading it', async () => {
    vi.stubGlobal('fetch', nativeFetch);
    vi.stubEnv('LLM_TIMEOUT_MS', '8000');
    let markClosed!: () => void;
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    const server = createServer((_request, response) => {
      response.once('close', markClosed);
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.write('Synthetic provider error body intentionally never ends');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local test server address');
      vi.stubEnv('LLM_API_URL', `http://127.0.0.1:${address.port}/chat/completions`);
      expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'provider_error' });
      const released = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>(resolve => { deadline = setTimeout(() => resolve(false), 500); }),
      ]);
      expect(released, 'The error-response socket must close after fallback, independently of its unfinished body').toBe(true);
    } finally {
      if (deadline) clearTimeout(deadline);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
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

describe('provider deadline and evidence regressions', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it.each(['5000ms', '1e3', '1.5', '-1', '0', 'Infinity', '0x20', ''])('rejects malformed timeout %s', configured => {
    vi.stubEnv('LLM_TIMEOUT_MS', configured); expect(getTimeoutMs()).toBe(8000);
  });
  it('settles even when the transport ignores abort and cleans the timer', async () => {
    vi.useFakeTimers(); vi.stubEnv('LLM_TIMEOUT_MS', '100');
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = rankWithModel(snapshot);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout', ms: 100 });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled response body as well as initial response headers', async () => {
    vi.useFakeTimers(); vi.stubEnv('LLM_TIMEOUT_MS', '100');
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const pending = rankWithModel(snapshot);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout' });
  });
  it('settles on caller cancellation and observes late provider rejection', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let rejectProvider!: (error: Error) => void;
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectProvider = reject; }));
    const pending = rankWithModel(snapshot, controller.signal);
    controller.abort(new Error('private caller details'));
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout', detail: 'Request cancelled' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    rejectProvider(new Error('late private provider error'));
    await vi.advanceTimersByTimeAsync(0);
  });
  it.each(['success', 'failure'])('cleans caller listeners after %s', async outcome => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    if (outcome === 'success') fetchMock.mockResolvedValue(response('{"choices":[]}'));
    else fetchMock.mockRejectedValue(new Error('secret key and provider error'));
    const result = await rankWithModel(snapshot, controller.signal);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  });
  it.each([{}, null, { choices: [{}] }, { choices: [{ message: { content: ' ' } }] }, { choices: [{ message: { content: {} } }] }])('rejects malformed provider envelope %#', async body => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
  it.each(['length', 'content_filter', 'tool_calls'])('rejects finish_reason=%s despite valid JSON', async finish_reason => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: '{"choices":[]}' } }] })));
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
  it('never exposes provider refusal text', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { refusal: 'private refusal', content: '{}' } }] })));
    const result = await rankWithModel(snapshot);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('private refusal');
  });
  it('uses a changed key on the next request without cached credentials', async () => {
    fetchMock.mockImplementation(async () => response('{}'));
    vi.stubEnv('LLM_API_KEY', ' first-key '); await rankWithModel(snapshot);
    vi.stubEnv('LLM_API_KEY', ' second-key '); await rankWithModel(snapshot);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer first-key');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer second-key');
  });
});
