import type {
  AiRankingInput,
  Candidate,
  Id,
  RecommendationCard,
  SkillView,
} from '../../../../contracts/backend'
import { assertCandidateEvidence } from './recommendation-evidence'

/**
 * Reproducible baseline ordering, per docs/BACKEND.md section 9.
 *
 * Comparison order for v1:
 *   1. more fully closed critical gaps
 *   2. higher weighted_direct_gain + 0.5 * weighted_unlocked_gain (critical weight 2)
 *   3. fewer negative outcomes across the last three participations of the same event
 *   4. lower effort
 *   5. continue an equivalent existing attempt, then event_id and candidate_id
 *
 * This is a product heuristic for comparison, not a trained metric and not a
 * claimed probability of success. It is also what mode=rules_fallback returns,
 * and the yardstick the AI path has to beat - so it is a real attempt at a good
 * answer, not a strawman.
 */

/**
 * Two terms of the specified ordering cannot be computed from Candidate alone:
 * the gains behind unlocks_event_ids, and the outcome history of the same
 * event. The service that owns the data supplies them here; both default to 0,
 * which degrades the comparison to steps 1, 2 (direct part), 4 and 5.
 */
export type BaselineSignals = {
  /** Best single future weighted gain unlocked by this candidate - a max, never a sum. */
  unlockedWeightedGain: ReadonlyMap<Id, number>
  /** Negative outcomes among the last three participations of the same event. */
  negativeOutcomes: ReadonlyMap<Id, number>
}

export const NO_SIGNALS: BaselineSignals = {
  unlockedWeightedGain: new Map(),
  negativeOutcomes: new Map(),
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
    if (change.gain <= 0) continue
    const skill = skills.get(change.skill_id)
    if (!skill || skill.required_level === null) continue
    const remainingGap = Math.max(0, skill.required_level - skill.current_level)
    // Career relevance is the gap actually closed, not all levels an event adds.
    const usefulGain = Math.min(change.gain, remainingGap)
    total += usefulGain * (skill.critical ? CRITICAL_WEIGHT : ORDINARY_WEIGHT)
  }
  return total
}

export function rankBaseline(
  input: AiRankingInput,
  signals: BaselineSignals = NO_SIGNALS,
): Candidate[] {
  const skills = skillIndex(input.profile.skills)

  return [...input.candidates].sort((a, b) => {
    const criticalDiff = closedCriticalGaps(b, skills) - closedCriticalGaps(a, skills)
    if (criticalDiff !== 0) return criticalDiff

    const gainA =
      weightedDirectGain(a, skills) +
      UNLOCKED_DISCOUNT * (signals.unlockedWeightedGain.get(a.candidate_id) ?? 0)
    const gainB =
      weightedDirectGain(b, skills) +
      UNLOCKED_DISCOUNT * (signals.unlockedWeightedGain.get(b.candidate_id) ?? 0)
    if (gainA !== gainB) return gainB - gainA

    const negA = signals.negativeOutcomes.get(a.candidate_id) ?? 0
    const negB = signals.negativeOutcomes.get(b.candidate_id) ?? 0
    if (negA !== negB) return negA - negB

    if (a.duration_hours !== b.duration_hours) return a.duration_hours - b.duration_hours

    if (a.action !== b.action) return a.action === 'continue' ? -1 : 1
    const eventOrder = a.event_id.localeCompare(b.event_id)
    return eventOrder || a.candidate_id.localeCompare(b.candidate_id)
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

function pickReasonFactIds(candidate: Candidate): Id[] {
  // Several facts in one category can be essential: a target requirement and
  // the conditional benefit of unlocking it must both survive the fallback.
  return CATEGORY_PRIORITY.flatMap((category) => candidate.facts
    .filter((fact) => fact.category === category)
    .map((fact) => fact.fact_id))
}

/** The cards returned with mode=rules_fallback. No alternative: nothing chose one. */
export function baselineCards(
  input: AiRankingInput,
  signals: BaselineSignals = NO_SIGNALS,
): RecommendationCard[] {
  // Validate all candidates, including those a model could choose beyond the top N.
  for (const candidate of input.candidates) assertCandidateEvidence(candidate)
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
