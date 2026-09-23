import { RANKING_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt';
import { z } from 'zod';
import type { AiRankingInput, FallbackReason } from '../types';
import type { BaselineSignals } from '../domain/baseline';

// A 1,400-token ranking and its envelope fit comfortably within this byte budget.
// Bound decoded transport bytes too: a provider can ignore output-token limits.
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 250;
const MIN_RETRY_BUDGET_MS = 2000;
const CompletionEnvelope = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal('stop'),
    message: z.object({ content: z.string().trim().min(1), refusal: z.string().nullish() }),
  })).length(1),
});

async function readProviderJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Missing provider body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let complete = false;
  try {
    signal.throwIfAborted();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('Provider body too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    complete = true;
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

function retryDelayMs(response: Response): number {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return RETRY_DELAY_MS;
  const delay = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(delay) ? RETRY_DELAY_MS : Math.max(RETRY_DELAY_MS, delay);
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Request stopped')); return; }
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new Error('Request stopped'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** One provider with at most one transient-failure retry inside the total deadline. */
export type AdapterResult =
  | { ok: true; output: unknown; ms: number }
  | { ok: false; reason: FallbackReason; detail: string; ms: number | null };
export function getModel(): string { return process.env.LLM_MODEL?.trim() || ''; }
export function isAiConfigured(): boolean { return Boolean(process.env.LLM_API_KEY?.trim() && getModel()); }
export function getTimeoutMs(): number {
  const configured = process.env.LLM_TIMEOUT_MS?.trim() || '';
  if (!/^\d+$/.test(configured)) return 8000;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 ? Math.max(100, Math.min(8000, value)) : 8000;
}

export async function rankWithModel(input: AiRankingInput, externalSignal?: AbortSignal, signals?: BaselineSignals): Promise<AdapterResult> {
  const key = process.env.LLM_API_KEY?.trim();
  if (!key || !getModel()) return { ok: false, reason: 'missing_api_key', detail: 'LLM_API_KEY and LLM_MODEL are required', ms: null };
  if (!input.candidates.length) return { ok: false, reason: 'provider_error', detail: 'called with no candidates', ms: null };
  if (externalSignal?.aborted) return { ok: false, reason: 'provider_timeout', detail: 'Request cancelled', ms: 0 };
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const started = Date.now();
  let stoppedBy: 'deadline' | 'caller' | undefined;
  let rejectBoundary!: (error: Error) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const stop = (reason: 'deadline' | 'caller') => {
    if (stoppedBy) return;
    stoppedBy = reason;
    rejectBoundary(new Error('Request stopped'));
    controller.abort();
  };
  const onCallerAbort = () => stop('caller');
  externalSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => stop('deadline'), timeoutMs);
  const failed = (reason: FallbackReason, detail: string): AdapterResult => ({ ok: false, reason, detail, ms: Date.now() - started });
  const retry = async (attempt: number, delay: number): Promise<boolean> => {
    // A retry must respect Retry-After and still leave time for a useful answer.
    // Never reset the deadline or continue work after a caller has left.
    if (attempt !== 0 || controller.signal.aborted || timeoutMs - (Date.now() - started) < delay + MIN_RETRY_BUDGET_MS) return false;
    await waitForRetry(delay, controller.signal);
    controller.signal.throwIfAborted();
    return true;
  };
  try {
    const model = getModel();
    const payload = JSON.stringify({ model, store: false, max_completion_tokens: 1400,
      // Ranking verified candidates does not need xhigh reasoning. Keep enough
      // of the eight-second budget for the answer and a transient-failure retry.
      ...(['gpt-6-luna', 'gpt-6-sol'].includes(model) ? { reasoning_effort: 'low' } : {}),
      ...(/^(gpt-4o|gpt-4\.1)(-|$)/.test(model) ? { temperature: 0 } : {}),
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserMessage(input, signals) }],
      response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
    });
    const request = (async (): Promise<AdapterResult> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        // Closing an error response must not cancel the overall retry budget.
        const transport = new AbortController();
        const abortTransport = () => transport.abort();
        controller.signal.addEventListener('abort', abortTransport, { once: true });
        try {
          let response: Response;
          try {
            response = await fetch(process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions', {
              method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              signal: transport.signal, body: payload,
            });
          } catch {
            if (await retry(attempt, RETRY_DELAY_MS)) continue;
            return failed('provider_error', 'Provider request failed');
          }
          if (!response.ok) {
            const delay = retryDelayMs(response);
            // Do not consume an error body: it may stream indefinitely.
            transport.abort();
            if (RETRYABLE_STATUSES.has(response.status) && await retry(attempt, delay)) continue;
            return failed('provider_error', 'Provider returned an unsuccessful HTTP status');
          }
          let body: unknown;
          try { body = await readProviderJson(response, transport.signal); }
          catch {
            transport.abort();
            return failed('invalid_response', 'Provider response was not bounded UTF-8 JSON');
          }
          const envelope = CompletionEnvelope.safeParse(body);
          if (!envelope.success) return failed('invalid_response', 'Invalid completion envelope');
          const choice = envelope.data.choices[0]!;
          if (choice.message.refusal) return failed('invalid_response', 'Provider refused completion');
          const content = choice.message.content;
          try { return { ok: true, output: JSON.parse(content), ms: Date.now() - started }; }
          catch { return failed('invalid_response', 'Completion was not JSON'); }
        } finally {
          controller.signal.removeEventListener('abort', abortTransport);
        }
      }
      return failed('provider_error', 'Provider attempts exhausted');
    })();
    // The race also bounds a stalled body reader or a transport that ignores abort,
    // and observes late rejections after the response has already returned.
    return await Promise.race([request, boundary]);
  } catch {
    return stoppedBy
      ? failed('provider_timeout', stoppedBy === 'caller' ? 'Request cancelled' : `Aborted within ${timeoutMs}ms budget`)
      : failed('provider_error', 'Provider request failed');
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onCallerAbort);
  }
}
