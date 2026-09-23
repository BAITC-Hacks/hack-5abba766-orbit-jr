import { RANKING_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt';
import type { AiRankingInput, FallbackReason } from '../types';

/** One native provider transport; no hidden retries, cached key, or second AI engine. */
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

export async function rankWithModel(input: AiRankingInput, externalSignal?: AbortSignal): Promise<AdapterResult> {
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
  try {
    const request = (async (): Promise<AdapterResult> => {
      const response = await fetch(process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model: getModel(), store: false, max_completion_tokens: 1400,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserMessage(input) }],
          response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
        }),
      });
      if (!response.ok) return failed('provider_error', 'Provider returned an unsuccessful HTTP status');
      let body: { choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] } | null;
      try { body = await response.json(); }
      catch { return failed('invalid_response', 'Provider response was not JSON'); }
      const choice = body?.choices?.[0];
      if (choice?.message?.refusal) return failed('invalid_response', 'Provider refused completion');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') return failed('invalid_response', 'Completion did not finish normally');
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return failed('invalid_response', 'Empty completion');
      try { return { ok: true, output: JSON.parse(content), ms: Date.now() - started }; }
      catch { return failed('invalid_response', 'Completion was not JSON'); }
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
