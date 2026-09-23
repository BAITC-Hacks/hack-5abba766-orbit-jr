import type { Candidate, FactCategory, Id } from '../types'

export const REQUIRED_FACT_CATEGORIES: ReadonlySet<FactCategory> = new Set([
  'grade', 'skill_gap', 'history', 'target_requirement',
])
export const MIN_REQUIRED_FACT_CATEGORIES = 3

/** A broken backend snapshot must not turn into a plausible-looking fallback. */
export class InvalidRecommendationEvidenceError extends Error {
  constructor(readonly candidateId: Id, detail: string) {
    super(`Invalid recommendation evidence for ${candidateId}: ${detail}`)
    this.name = 'InvalidRecommendationEvidenceError'
  }
}

export function assertCandidateEvidence(candidate: Candidate): void {
  const ids = new Set<Id>()
  const categories = new Set<FactCategory>()
  for (const fact of candidate.facts) {
    if (!fact.fact_id.trim() || !fact.text.trim() || ids.has(fact.fact_id)) {
      throw new InvalidRecommendationEvidenceError(candidate.candidate_id, 'empty or duplicate fact')
    }
    ids.add(fact.fact_id)
    if (REQUIRED_FACT_CATEGORIES.has(fact.category)) categories.add(fact.category)
  }
  if (categories.size < MIN_REQUIRED_FACT_CATEGORIES) {
    throw new InvalidRecommendationEvidenceError(
      candidate.candidate_id,
      `covers ${categories.size} required categories, needs ${MIN_REQUIRED_FACT_CATEGORIES}`,
    )
  }
}

/** Check the whole set, including alternatives and candidates below the display limit. */
export function assertRecommendationEvidence(candidates: readonly Candidate[]): void {
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate.candidate_id.trim() || ids.has(candidate.candidate_id)) {
      throw new InvalidRecommendationEvidenceError(candidate.candidate_id, 'empty or duplicate candidate IDs')
    }
    ids.add(candidate.candidate_id)
    assertCandidateEvidence(candidate)
  }
}
