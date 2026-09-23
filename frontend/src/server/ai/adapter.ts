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
  return Boolean(process.env['LLM_API_KEY'])
}

export function getModel(): string {
  // An env var set to an empty string is a misconfiguration, not a choice:
  // ?? would pass '' straight through to the provider.
  const configured = process.env['LLM_MODEL']?.trim()
  return configured ? configured : DEFAULT_MODEL
}

export function getTimeoutMs(): number {
  const parsed = Number.parseInt(process.env['LLM_TIMEOUT_MS'] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

let client: OpenAI | null = null

function getClient(apiKey: string): OpenAI {
  if (!client) client = new OpenAI({ apiKey })
  return client
}

/** Test seam: the module caches one client per process. */
export function resetClientForTests(): void {
  client = null
}

export async function rankWithModel(input: AiRankingInput): Promise<AdapterResult> {
  const apiKey = process.env['LLM_API_KEY']
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key', detail: 'LLM_API_KEY is not set', ms: null }
  }
  if (input.candidates.length === 0) {
    // Section 10: an empty set is mode=no_candidates, decided before we are called.
    return { ok: false, reason: 'provider_error', detail: 'called with no candidates', ms: null }
  }

  const timeoutMs = getTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await getClient(apiKey).chat.completions.create(
      {
        model: getModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
        response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
        temperature: 0,
      },
      { signal: controller.signal },
    )

    const ms = Date.now() - started
    const content = response.choices[0]?.message.content
    if (!content) {
      return { ok: false, reason: 'invalid_response', detail: 'empty completion', ms }
    }

    try {
      return { ok: true, output: JSON.parse(content) as unknown, ms }
    } catch {
      return { ok: false, reason: 'invalid_response', detail: 'completion was not JSON', ms }
    }
  } catch (error) {
    const ms = Date.now() - started
    if (controller.signal.aborted) {
      return { ok: false, reason: 'provider_timeout', detail: `aborted after ${timeoutMs}ms`, ms }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'provider_error', detail, ms }
  } finally {
    clearTimeout(timer)
  }
}
