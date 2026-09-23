import { describe, expect, it } from 'vitest'
import { acceptanceCases } from '../../evaluation/acceptance-cases'
import { validateRanking } from '../../src/ai/response-validator'
import { baselineCards, closedCriticalGaps, rankBaseline, weightedDirectGain } from '../../src/domain/baseline'

describe('additional synthetic acceptance scenarios', () => {
  it.each(acceptanceCases)('$id has consistent skills, gains, progress and citable facts', (testCase) => {
    const { input, signals } = testCase
    expect(signals.negativeOutcomes.size).toBe(input.candidates.length)
    expect(signals.unlockedWeightedGain.size).toBe(input.candidates.length)
    expect(signals.similarFormatPenalty.size).toBe(input.candidates.length)
    const skills = new Map(input.profile.skills.map((item) => [item.skill_id, item]))
    const total = input.profile.skills.reduce((sum, item) => sum + item.required_level!, 0)
    const covered = input.profile.skills.reduce((sum, item) => sum + Math.min(item.current_level, item.required_level!), 0)
    expect(input.profile.progress!.coverage).toBeCloseTo(covered / total)
    expect(input.profile.progress!.gap_points).toBeCloseTo(total - covered)
    expect(input.profile.progress!.missing_critical_skill_ids).toEqual(input.profile.skills.filter((item) => item.critical && item.gap! > 0).map((item) => item.skill_id))
    expect(new Set(input.candidates.map((candidate) => candidate.candidate_id)).size).toBe(input.candidates.length)
    const allFactIds = input.candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.fact_id))
    expect(new Set(allFactIds).size).toBe(allFactIds.length)
    for (const item of input.profile.skills) {
      expect(item.gap).toBe(Math.max(0, item.required_level! - item.current_level))
      expect(item.current_level).toBeGreaterThanOrEqual(0)
      expect(item.required_level).toBeLessThanOrEqual(5)
    }
    for (const candidate of input.candidates) {
      let gain = 0
      for (const change of candidate.expected_skill_changes) {
        const item = skills.get(change.skill_id)!
        expect(item).toBeDefined()
        expect(change.before).toBe(item.current_level)
        expect(change.gain).toBeCloseTo(change.after - change.before)
        expect(change.gain).toBeGreaterThan(0)
        expect(change.after).toBeLessThanOrEqual(5)
        gain += Math.min(change.after, item.required_level!) - Math.min(change.before, item.required_level!)
        expect(candidate.facts.find((fact) => fact.category === 'skill_gap')!.text)
          .toContain(`${change.skill_id}: current ${change.before}; expected ${change.after}; gain ${change.gain}`)
      }
      expect(candidate.goal_coverage_delta).toBeCloseTo(gain / total)
      expect(candidate.goal_coverage_delta).toBeGreaterThan(0)
      expect(candidate.facts.find((fact) => fact.category === 'target_requirement')!.text).toContain(`this activity adds ${gain} covered points`)
      expect(signals.negativeOutcomes.get(candidate.candidate_id)).toBe(0)
      expect(signals.similarFormatPenalty.get(candidate.candidate_id)).toBe(0)
      expect(candidate.facts.find((fact) => fact.category === 'history')!.text).toContain('negative outcomes: 0')
      expect(candidate.unlocks_event_ids).toEqual([])
      expect(signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(0)
      expect(validateRanking({ choices: [{ candidate_id: candidate.candidate_id, reason_fact_ids: candidate.facts.map((fact) => fact.fact_id) }] }, input).ok).toBe(true)
    }
  })

  it.each(acceptanceCases)('$id preserves its expected winner and determining citations across candidate positions', (testCase) => {
    const { candidates } = testCase.input
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const input = { ...testCase.input, candidates: [...candidates.slice(offset), ...candidates.slice(0, offset)] }
      expect(rankBaseline(input, testCase.signals)[0]!.candidate_id).toBe(testCase.expectedTopCandidateIds[0])
      const top = baselineCards(input, testCase.signals)[0]!
      for (const factId of testCase.requiredTopFactIds!) expect(top.reason_fact_ids).toContain(factId)
    }
  })

  it('isolates critical weighting from complete gap closure, effort and history', () => {
    const testCase = acceptanceCases[0]!
    const skills = new Map(testCase.input.profile.skills.map((item) => [item.skill_id, item]))
    const [ordinary, critical] = testCase.input.candidates
    for (const candidate of testCase.input.candidates) expect(closedCriticalGaps(candidate, skills)).toBe(0)
    expect(ordinary!.expected_skill_changes[0]!.gain).toBe(2.5)
    expect(critical!.expected_skill_changes[0]!.gain).toBe(1.5)
    expect(weightedDirectGain(ordinary!, skills)).toBe(2.5)
    expect(weightedDirectGain(critical!, skills)).toBe(3)
    expect(critical!.duration_hours).toBeGreaterThan(ordinary!.duration_hours)
    expect(testCase.expectedTopCandidateIds).toEqual([critical!.candidate_id])
  })

  it('permits one, two or three candidate-local cards without requiring exactly three', () => {
    const testCase = acceptanceCases[1]!
    expect(testCase.input.limit).toBe(3)
    expect(testCase.input.candidates.length).toBeGreaterThanOrEqual(3)
    const ranked = rankBaseline(testCase.input, testCase.signals)
    expect(testCase.expectedCandidateOrder).toEqual(['option:9c/b', 'option:9c/d', 'option:9c/c', 'option:9c/a'])
    expect(ranked.map((candidate) => candidate.candidate_id)).toEqual(testCase.expectedCandidateOrder)
    for (const count of [1, 2, 3]) {
      const result = validateRanking({ choices: ranked.slice(0, count).map((candidate) => ({
        candidate_id: candidate.candidate_id,
        reason_fact_ids: candidate.facts.map((fact) => fact.fact_id),
      })) }, testCase.input)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.cards).toHaveLength(count)
        expect(result.cards[0]!.candidate_id).toBe(testCase.expectedTopCandidateIds[0])
        expect(result.cards.map((card) => card.rank)).toEqual(Array.from({ length: count }, (_, index) => index + 1))
      }
    }
  })
})
