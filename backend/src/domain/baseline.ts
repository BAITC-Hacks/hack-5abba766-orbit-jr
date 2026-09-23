import { assertRecommendationEvidence, assertCandidateEvidence } from './recommendation-evidence'
import type {
  AiRankingInput,
  Candidate,
  Id,
  RecommendationCard,
  SkillView,
} from '../types'

/**
 * Reproducible baseline ordering, per docs/BACKEND.md section 9.
 *
 * Comparison order for v1:
 *   1. more fully closed critical gaps
 *   2. higher weighted_direct_gain + 0.5 * weighted_unlocked_gain (critical weight 2)
 *   3. fewer negative outcomes across the last three participations of the same event
 *   4. fewer negative observations in a sufficiently observed similar format
 *   5. lower effort, then continue an equivalent attempt and stable IDs
 *
 * This is a product heuristic for comparison, not a trained metric and not a
 * claimed probability of success. It is also what mode=rules_fallback returns,
 * and the substantive ordering policy enforced at the AI boundary. Agreement
 * with this heuristic is policy compliance, not evidence of model uplift.
 */

/**
 * Three terms of the ordering cannot be computed from Candidate alone: gains
 * behind unlocks_event_ids, exact-event outcomes, and similar-format outcomes.
 * The domain layer supplies all signals for every candidate. Missing signals
 * are a programming error: production must not silently weaken the baseline.
 */
export type BaselineSignals = {
  /** Best single future weighted gain unlocked by this candidate - a max, never a sum. */
  unlockedWeightedGain: ReadonlyMap<Id, number>
  /** Negative outcomes among the last three participations of the same event. */
  negativeOutcomes: ReadonlyMap<Id, number>
  /** Observed negative share for other same-skill, same-format activities; zero when sample < 3. Not a success probability. */
  similarFormatPenalty: ReadonlyMap<Id, number>
}

type BaselineInput = Pick<AiRankingInput, 'candidates'> & { profile: Pick<AiRankingInput['profile'], 'skills'> }

function signalValue(map: ReadonlyMap<Id, number>, id: Id): number {
  const value = map.get(id)
  if (value === undefined || !Number.isFinite(value) || value < 0) throw new Error(`Missing or invalid baseline signal for ${id}`)
  return value
}

const CRITICAL_WEIGHT = 2
const ORDINARY_WEIGHT = 1
const UNLOCKED_DISCOUNT = 0.5

function skillIndex(skills: readonly SkillView[]): Map<Id, SkillView> {
  return new Map(skills.map((s) => [s.skill_id, s]))
}

export function closedCriticalGaps(candidate: Candidate, skills: Map<Id, SkillView>): number {
  let closed = 0
  for (const change of candidate.expected_skill_changes) {
    const skill = skills.get(change.skill_id)
    if (!skill?.critical) continue
    if (skill.required_level === null) continue
    if (skill.gap === null || skill.gap <= 0) continue
    if (change.after >= skill.required_level) closed += 1
  }
  return closed
}

export function weightedDirectGain(candidate: Candidate, skills: Map<Id, SkillView>): number {
  let total = 0
  for (const change of candidate.expected_skill_changes) {
    const skill = skills.get(change.skill_id)
    if (skill?.required_level == null || skill.required_level <= 0) continue
    const closedGap = Math.max(0, Math.min(change.after, skill.required_level) - Math.min(change.before, skill.required_level))
    total += closedGap * (skill.critical ? CRITICAL_WEIGHT : ORDINARY_WEIGHT)
  }
  return total
}

/** Shared arithmetic for ordering and model context; missing domain signals are errors. */
export function candidateRankingFactors(candidate: Candidate, skills: Map<Id, SkillView>, signals: BaselineSignals) {
  const direct = weightedDirectGain(candidate, skills)
  const unlocked = signalValue(signals.unlockedWeightedGain, candidate.candidate_id)
  const formatPenalty = signalValue(signals.similarFormatPenalty, candidate.candidate_id)
  if (formatPenalty > 1) throw new Error(`Invalid similar-format baseline signal for ${candidate.candidate_id}`)
  return {
    closed_critical_gaps: closedCriticalGaps(candidate, skills),
    weighted_direct_gain: direct,
    best_unlocked_weighted_gain: unlocked,
    weighted_target_value: direct + UNLOCKED_DISCOUNT * unlocked,
    recent_negative_outcomes: signalValue(signals.negativeOutcomes, candidate.candidate_id),
    similar_format_penalty: formatPenalty,
  }
}

/** Hard product priorities; exact policy ties deliberately exclude arbitrary IDs. */
export function comparePolicyPriority(a: Candidate, b: Candidate,
  factors: ReadonlyMap<Id, ReturnType<typeof candidateRankingFactors>>): number {
  const aFactors = factors.get(a.candidate_id)!
  const bFactors = factors.get(b.candidate_id)!
  return bFactors.closed_critical_gaps - aFactors.closed_critical_gaps ||
    bFactors.weighted_target_value - aFactors.weighted_target_value ||
    aFactors.recent_negative_outcomes - bFactors.recent_negative_outcomes ||
    aFactors.similar_format_penalty - bFactors.similar_format_penalty ||
    a.duration_hours - b.duration_hours ||
    (a.action === b.action ? 0 : a.action === 'continue' ? -1 : 1)
}

export function rankBaseline(
  input: BaselineInput,
  signals: BaselineSignals,
): Candidate[] {
  assertRecommendationEvidence(input.candidates)
  const skills = skillIndex(input.profile.skills)
  const factors = new Map(input.candidates.map(candidate => [
    candidate.candidate_id, candidateRankingFactors(candidate, skills, signals),
  ]))

  return [...input.candidates].sort((a, b) => {
    const priority = comparePolicyPriority(a, b, factors)
    if (priority !== 0) return priority
    const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
    return compare(a.event_id, b.event_id) || compare(a.candidate_id, b.candidate_id)
  })
}

/** Order the categories the contract wants covered first, then the rest. */
const CATEGORY_PRIORITY = [
  'skill_gap',
  'target_requirement',
  'grade',
  'history',
  'eligibility',
  'effort',
] as const

export function pickReasonFactIds(candidate: Candidate): Id[] {
  assertCandidateEvidence(candidate)
  // Retain multiple relevant facts in a category, e.g. requirement and conditional unlock.
  return CATEGORY_PRIORITY.flatMap(category => candidate.facts
    .filter(fact => fact.category === category).map(fact => fact.fact_id))
}

/** The cards returned with mode=rules_fallback. No alternative: nothing chose one. */
export function baselineCards(
  input: AiRankingInput,
  signals: BaselineSignals,
): RecommendationCard[] {
  return rankBaseline(input, signals)
    .slice(0, input.limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      reason_fact_ids: pickReasonFactIds(candidate),
      alternative_candidate_id: null,
      alternative: null,
    }))
}
