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
 *   4. lower effort
 *   5. continue an equivalent existing attempt, then stable event and candidate IDs
 *
 * This is a product heuristic for comparison, not a trained metric and not a
 * claimed probability of success. It is also what mode=rules_fallback returns,
 * and the yardstick the AI path has to beat - so it is a real attempt at a good
 * answer, not a strawman.
 */

/**
 * Two terms of the specified ordering cannot be computed from Candidate alone:
 * the gains behind unlocks_event_ids, and the outcome history of the same
 * event. The domain layer supplies both signals for every candidate. Missing signals
 * are a programming error: production must not silently weaken the baseline.
 */
export type BaselineSignals = {
  /** Best single future weighted gain unlocked by this candidate - a max, never a sum. */
  unlockedWeightedGain: ReadonlyMap<Id, number>
  /** Negative outcomes among the last three participations of the same event. */
  negativeOutcomes: ReadonlyMap<Id, number>
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

export function rankBaseline(
  input: BaselineInput,
  signals: BaselineSignals,
): Candidate[] {
  assertRecommendationEvidence(input.candidates)
  const skills = skillIndex(input.profile.skills)
  for (const candidate of input.candidates) {
    signalValue(signals.unlockedWeightedGain, candidate.candidate_id)
    signalValue(signals.negativeOutcomes, candidate.candidate_id)
  }

  return [...input.candidates].sort((a, b) => {
    const criticalDiff = closedCriticalGaps(b, skills) - closedCriticalGaps(a, skills)
    if (criticalDiff !== 0) return criticalDiff

    const gainA =
      weightedDirectGain(a, skills) +
      UNLOCKED_DISCOUNT * signalValue(signals.unlockedWeightedGain, a.candidate_id)
    const gainB =
      weightedDirectGain(b, skills) +
      UNLOCKED_DISCOUNT * signalValue(signals.unlockedWeightedGain, b.candidate_id)
    if (gainA !== gainB) return gainB - gainA

    const negA = signalValue(signals.negativeOutcomes, a.candidate_id)
    const negB = signalValue(signals.negativeOutcomes, b.candidate_id)
    if (negA !== negB) return negA - negB

    if (a.duration_hours !== b.duration_hours) return a.duration_hours - b.duration_hours

    if (a.action !== b.action) return a.action === 'continue' ? -1 : 1
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
