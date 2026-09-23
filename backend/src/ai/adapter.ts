import { RANKING_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt';
import type { AiRankingInput, FallbackReason } from '../types';

/** One provider transport for the whole app; the result union preserves the team AI interface. */
export type AdapterResult =
  | { ok: true; output: unknown; ms: number }
  | { ok: false; reason: FallbackReason; detail: string; ms: number | null };

export function getModel(): string { return process.env.LLM_MODEL?.trim() || ''; }
export function isAiConfigured(): boolean { return Boolean(process.env.LLM_API_KEY?.trim() && getModel()); }
export function getTimeoutMs(): number {
  const value = Number(process.env.LLM_TIMEOUT_MS || 8000);
  return Number.isFinite(value) && value > 0 ? Math.max(100, Math.min(8000, value)) : 8000;
}

/** No retries or provider messages leak into HTTP responses; semantic checks are separate. */
export async function rankWithModel(input: AiRankingInput, externalSignal?: AbortSignal): Promise<AdapterResult> {
  const key = process.env.LLM_API_KEY?.trim();
  if (!key || !getModel()) return { ok: false, reason: 'missing_api_key', detail: 'LLM_API_KEY and LLM_MODEL are required', ms: null };
  if (!input.candidates.length) return { ok: false, reason: 'provider_error', detail: 'called with no candidates', ms: null };
  const controller = new AbortController();
  const timeoutMs = getTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  const started = performance.now();
  const failed = (reason: FallbackReason, detail: string): AdapterResult => ({ ok: false, reason, detail, ms: Math.round(performance.now() - started) });
  try {
    signal.throwIfAborted();
    const response = await fetch(process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model: getModel(), store: false, max_completion_tokens: 1400,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserMessage(input) }],
        response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
      }),
    });
    if (!response.ok) return failed('provider_error', 'Provider returned an unsuccessful HTTP status');
    let body: { choices?: { message?: { content?: string; refusal?: string } }[] };
    try { body = await response.json(); }
    catch { return signal.aborted ? failed('provider_timeout', 'Provider response exceeded time budget') : failed('invalid_response', 'Provider response was not JSON'); }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content || body.choices?.[0]?.message?.refusal) return failed('invalid_response', 'Empty or refused completion');
    try { return { ok: true, output: JSON.parse(content), ms: Math.round(performance.now() - started) }; }
    catch { return failed('invalid_response', 'Completion was not JSON'); }
  } catch {
    return signal.aborted ? failed('provider_timeout', `Aborted within ${timeoutMs}ms budget`) : failed('provider_error', 'Provider request failed');
  } finally { clearTimeout(timer); }
}
