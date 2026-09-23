import OpenAI from 'openai'
import { RANKING_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt'
import type { AiRankingInput, FallbackReason } from '../../../../contracts/backend'

/**
 * The only module that talks to the LLM provider.
 *
 * Configuration comes from server-side env only (docs/BACKEND.md section 16):
 * LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS. Never NEXT_PUBLIC_*. The caller can
 * never supply a provider endpoint.
 *
 * This function does not throw. Every failure maps to a FallbackReason so the
 * recommendations service can return a degraded result instead of an error.
 */

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MODEL = 'gpt-4o-mini'

export type AdapterResult =
  | { ok: true; output: unknown; ms: number }
  | { ok: false; reason: FallbackReason; detail: string; ms: number | null }

/** Mirrors HealthView.ai_configured: presence of configuration, not connectivity. */
export function isAiConfigured(): boolean {
  return Boolean(process.env['LLM_API_KEY']?.trim())
}

export function getModel(): string {
  // An env var set to an empty string is a misconfiguration, not a choice:
  // ?? would pass '' straight through to the provider.
  const configured = process.env['LLM_MODEL']?.trim()
  return configured ? configured : DEFAULT_MODEL
}

export function getTimeoutMs(): number {
  const configured = process.env['LLM_TIMEOUT_MS']?.trim() ?? ''
  if (!/^\d+$/.test(configured)) return DEFAULT_TIMEOUT_MS
  const parsed = Number(configured)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, DEFAULT_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
}

let client: OpenAI | null = null
let clientApiKey: string | null = null

function getClient(apiKey: string): OpenAI {
  if (!client || clientApiKey !== apiKey) {
    client = new OpenAI({ apiKey, maxRetries: 0 })
    clientApiKey = apiKey
  }
  return client
}

/** Test seam: the module caches one client per process. */
export function resetClientForTests(): void {
  client = null
  clientApiKey = null
}

export async function rankWithModel(
  input: AiRankingInput,
  signal?: AbortSignal,
): Promise<AdapterResult> {
  const apiKey = process.env['LLM_API_KEY']?.trim()
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key', detail: 'LLM_API_KEY is not set', ms: null }
  }
  if (input.candidates.length === 0) {
    // Section 10: an empty set is mode=no_candidates, decided before we are called.
    return { ok: false, reason: 'provider_error', detail: 'called with no candidates', ms: null }
  }
  if (signal?.aborted) {
    return { ok: false, reason: 'provider_error', detail: 'request cancelled', ms: 0 }
  }

  const timeoutMs = getTimeoutMs()
  const controller = new AbortController()
  const started = Date.now()
  let stoppedBy: 'deadline' | 'caller' | undefined
  let rejectBoundary: (reason: Error) => void = () => {}
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject
  })
  const stop = (reason: 'deadline' | 'caller') => {
    if (stoppedBy) return
    stoppedBy = reason
    rejectBoundary(new Error('request stopped'))
    controller.abort()
  }
  const onCallerAbort = () => stop('caller')
  const timer = setTimeout(() => stop('deadline'), timeoutMs)
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const request = getClient(apiKey).chat.completions.create(
      {
        model: getModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
        response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
        temperature: 0,
      },
      { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 },
    )
    // Aborting the transport alone is insufficient if it ignores the signal.
    // Promise.race also observes any late provider rejection after we return.
    const response = await Promise.race([request, boundary])

    const ms = Date.now() - started
    const choice = response?.choices?.[0]
    if (choice?.message?.refusal) {
      return { ok: false, reason: 'invalid_response', detail: 'provider refused completion', ms }
    }
    if (choice?.finish_reason === 'length') {
      return { ok: false, reason: 'invalid_response', detail: 'completion exceeded output limit', ms }
    }
    if (choice?.finish_reason && choice.finish_reason !== 'stop') {
      return { ok: false, reason: 'invalid_response', detail: 'completion did not finish normally', ms }
    }
    const content = choice?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, reason: 'invalid_response', detail: 'empty completion', ms }
    }

    try {
      return { ok: true, output: JSON.parse(content) as unknown, ms }
    } catch {
      return { ok: false, reason: 'invalid_response', detail: 'completion was not JSON', ms }
    }
  } catch {
    const ms = Date.now() - started
    if (stoppedBy === 'deadline') {
      return { ok: false, reason: 'provider_timeout', detail: `aborted after ${timeoutMs}ms`, ms }
    }
    const detail = stoppedBy === 'caller' ? 'request cancelled' : 'provider request failed'
    return { ok: false, reason: 'provider_error', detail, ms }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
