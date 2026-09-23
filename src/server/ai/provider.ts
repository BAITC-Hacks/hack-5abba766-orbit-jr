import OpenAI from 'openai'
import { RANKING_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt'
import type { RecommendationInput } from '@/contracts/ai'

/**
 * The one place that talks to the LLM provider.
 *
 * Provider and model come from the environment, as the architecture requires.
 * Swapping providers means rewriting this file only - everything else works on
 * parsed JSON and knows nothing about who produced it.
 */

export const DEFAULT_TIMEOUT_MS = 8_000

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (client) return client
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set - copy .env.example to .env.local')
  client = new OpenAI({ apiKey })
  return client
}

export function getModel(): string {
  return process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini'
}

export function getTimeoutMs(): number {
  const raw = process.env['LLM_TIMEOUT_MS']
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

export type RankingCall = {
  /** Raw parsed JSON. Validation happens in validate.ts, not here. */
  raw: unknown
  ms: number
}

/**
 * One call, one deadline. Aborts rather than letting the request outlive the
 * 10s budget the brief allows for the whole response.
 */
export async function callRanking(
  input: RecommendationInput,
  signal?: AbortSignal,
): Promise<RankingCall> {
  const started = Date.now()
  const response = await getClient().chat.completions.create(
    {
      model: getModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
      response_format: { type: 'json_schema', json_schema: RANKING_JSON_SCHEMA },
      temperature: 0,
    },
    signal ? { signal } : {},
  )

  const ms = Date.now() - started
  const content = response.choices[0]?.message.content
  if (!content) throw new Error('model returned no content')

  return { raw: JSON.parse(content) as unknown, ms }
}
