import type { Candidate, RecommendationCard, RecommendationInput } from '@/contracts/ai'

/**
 * Deterministic multi-factor ranking.
 *
 * This is the fallback when the model times out or answers badly, AND the
 * baseline the AI path is measured against. The architecture is explicit that
 * comparing AI to a deliberately weak rule ("pick the largest single gain")
 * proves nothing, so this ranker is a genuine attempt at a good answer.
 */

const WEIGHTS = {
  gapLevels: 10, // levels gained on skills that are actually in the gap
  criticalLevels: 6, // extra weight when that skill is critical
  offGapLevels: 1, // gains outside the gap still count, barely
  preparatory: 4, // unlocks an activity that closes a gap
  continue: 3, // finishing something started beats opening something new
  rating: 2, // per point of average rating
  peers: 0.5, // per colleague of the same role/grade, capped below
  hourCost: 0.35, // subtracted per hour of duration
} as const

const MAX_PEER_BONUS = 3

export function scoreCandidate(candidate: Candidate): number {
  let score = 0

  for (const change of candidate.expected_changes) {
    const levels = change.to - change.from
    if (levels <= 0) continue
    if (change.closes_gap) {
      score += levels * WEIGHTS.gapLevels
      if (change.critical) score += levels * WEIGHTS.criticalLevels
    } else {
      score += levels * WEIGHTS.offGapLevels
    }
  }

  if (candidate.is_preparatory) score += WEIGHTS.preparatory
  if (candidate.action === 'continue') score += WEIGHTS.continue
  if (candidate.rating !== null) score += candidate.rating * WEIGHTS.rating
  score += Math.min(candidate.peer_count * WEIGHTS.peers, MAX_PEER_BONUS)
  score -= candidate.duration_hours * WEIGHTS.hourCost

  return score
}

/** Highest score first; ties broken by event_id so the order never wobbles. */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const diff = scoreCandidate(b) - scoreCandidate(a)
    if (diff !== 0) return diff
    return a.event_id.localeCompare(b.event_id)
  })
}

/** Picks the facts a card shows when no model chose them. */
function pickFacts(candidate: Candidate): Candidate['facts'] {
  const byCategory = new Map<string, Candidate['facts'][number]>()
  for (const fact of candidate.facts) {
    if (!byCategory.has(fact.category)) byCategory.set(fact.category, fact)
  }
  // Same priority the prompt asks the model to respect.
  const order = ['target_gap', 'critical_skill', 'skill_gain', 'prerequisite_unlock', 'duration', 'feedback', 'participation']
  const picked = order.flatMap((c) => {
    const fact = byCategory.get(c)
    return fact ? [fact] : []
  })
  return picked.length > 0 ? picked.slice(0, 4) : candidate.facts.slice(0, 4)
}

export function rulesCards(input: RecommendationInput, limit = 3): RecommendationCard[] {
  return rankCandidates(input.candidates)
    .slice(0, limit)
    .map((candidate) => ({
      event_id: candidate.event_id,
      title: candidate.title,
      action: candidate.action,
      duration_hours: candidate.duration_hours,
      factors: pickFacts(candidate),
      expected_changes: candidate.expected_changes,
      compared_to_event_id: null,
      note: null,
    }))
}
