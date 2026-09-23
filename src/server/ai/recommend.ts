import type { RecommendationInput, RecommendationResult } from '@/contracts/ai'
import { callRanking, getTimeoutMs } from './provider'
import { rulesCards } from './rank'
import { validateRanking } from './validate'

/**
 * The function the backend calls. Agreed signature - see docs/AI.md.
 *
 * It always returns a result. The AI path is an optimisation over the
 * deterministic ranker, never a dependency: a timeout, a provider outage or a
 * dishonest answer degrades the response, it does not fail the request.
 */
export async function recommend(input: RecommendationInput): Promise<RecommendationResult> {
  if (input.candidates.length === 0) {
    return {
      mode: 'rules_fallback',
      state_version: input.state_version,
      cards: [],
      reason: 'no eligible activities for this employee',
      diagnostics: { llm_ms: null, rejection: null },
    }
  }

  const fallback = (rejection: string, llmMs: number | null): RecommendationResult => ({
    mode: 'rules_fallback',
    state_version: input.state_version,
    cards: rulesCards(input),
    reason: 'ranked by rules - the AI answer was not usable',
    diagnostics: { llm_ms: llmMs, rejection },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), getTimeoutMs())

  let call: Awaited<ReturnType<typeof callRanking>>
  try {
    call = await callRanking(input, controller.signal)
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timeout after ${getTimeoutMs()}ms`
      : `provider error: ${error instanceof Error ? error.message : String(error)}`
    return fallback(reason, null)
  } finally {
    clearTimeout(timer)
  }

  const outcome = validateRanking(call.raw, input)
  if (!outcome.ok) return fallback(outcome.rejection, call.ms)

  return {
    mode: 'ai',
    state_version: input.state_version,
    cards: outcome.cards,
    reason: null,
    diagnostics: { llm_ms: call.ms, rejection: null },
  }
}
