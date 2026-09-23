import type { AiRankingInput, EmptyReason, RecommendationResult } from '../types'
import { baselineCards, type BaselineSignals } from '../domain/baseline'
import { rankWithModel } from './adapter'
import { validateRanking } from './response-validator'

export type RecommendationOptions = {
  /** Supply the real history/unlock signals; do not silently omit them in production. */
  signals: BaselineSignals
  /** Required for an empty candidate set: only the domain layer knows why it is empty. */
  emptyReason?: EmptyReason
  signal?: AbortSignal
}

/**
 * Pure-snapshot recommendation boundary for the backend service.
 * The service owns authentication, eligibility, evidence and DB version rechecks.
 * Invalid snapshots throw; provider failures fall back to equally validated facts.
 */
export async function recommend(
  input: AiRankingInput,
  options: RecommendationOptions,
): Promise<RecommendationResult> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 3) {
    throw new Error('Recommendation limit must be between 1 and 3')
  }
  const version = { ...input.version }
  if (input.candidates.length === 0) {
    if (!options.emptyReason) throw new Error('Empty candidates require a domain emptyReason')
    return {
      version, mode: 'no_candidates', fallback_reason: null,
      recommendations: [], empty_reason: options.emptyReason,
    }
  }
  if (options.emptyReason) throw new Error('Nonempty candidates cannot have an emptyReason')
  const ids = new Set<string>()
  for (const candidate of input.candidates) {
    if (!candidate.candidate_id.trim() || ids.has(candidate.candidate_id)) {
      throw new Error('Candidate snapshot contains empty or duplicate candidate IDs')
    }
    ids.add(candidate.candidate_id)
  }

  // Validate and prepare the baseline before spending time on a model request.
  const fallback = baselineCards(input, options.signals)
  const attempt = await rankWithModel(input, options.signal)
  if (attempt.ok) {
    const checked = validateRanking(attempt.output, input)
    if (checked.ok) {
      return {
        version, mode: 'ai', fallback_reason: null,
        recommendations: checked.cards, empty_reason: null,
      }
    }
  }
  return {
    version, mode: 'rules_fallback',
    fallback_reason: attempt.ok ? 'invalid_response' : attempt.reason,
    recommendations: fallback, empty_reason: null,
  }
}
