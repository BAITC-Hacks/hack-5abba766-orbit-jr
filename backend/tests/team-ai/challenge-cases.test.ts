import { describe, expect, it } from 'vitest'
import { challengeCases } from '../../evaluation/challenge-cases'
import { validateRanking } from '../../src/ai/response-validator'
import { scoreEvaluation, summarizeEvaluations } from '../../evaluation/metrics'
import { baselineCards, rankBaseline, weightedDirectGain } from '../../src/domain/baseline'

describe('independently authored challenge scenarios', () => {
  it('keeps distinct authored choices, including the explicitly marked post-review regression', () => {
    expect(challengeCases).toHaveLength(8)
    expect(new Set(challengeCases.map((item) => item.id)).size).toBe(8)
    expect(challengeCases[7]!.description).toContain('Post-review authored regression')
    for (const testCase of challengeCases) {
      expect(testCase.expectedTopCandidateIds).toHaveLength(1)
      const top = testCase.input.candidates.find((item) => item.candidate_id === testCase.expectedTopCandidateIds[0])!
      expect(top).toBeDefined()
      for (const factId of testCase.requiredTopFactIds!) {
        expect(top.facts.map((fact) => fact.fact_id)).toContain(factId)
      }
    }
  })

  it('requires only unique deciding evidence beyond the shared category check', () => {
    const labelled = challengeCases.filter((item) => item.requiredTopFactIds?.length)
    expect(labelled.map((item) => [item.id, item.requiredTopFactIds])).toEqual([
      ['challenge-history-control', ['choice:8b/1/effort']],
      ['challenge-history-only-change', ['choice:8b/l/history']],
      ['challenge-unlock-citation', ['step:41/b/unlock']],
      ['challenge-direct-with-conditional-unlock', ['step:mixed/b/unlock']],
    ])
  })

  it.each(challengeCases)('$id has consistent levels, history, progress and candidate-local evidence', (testCase) => {
    const { input, signals } = testCase
    expect(signals.negativeOutcomes.size).toBe(input.candidates.length)
    expect(signals.unlockedWeightedGain.size).toBe(input.candidates.length)
    expect(signals.similarFormatPenalty.size).toBe(input.candidates.length)
    const skills = new Map(input.profile.skills.map((item) => [item.skill_id, item]))
    const requirements = input.profile.skills.filter((item) => item.required_level !== null)
    const total = requirements.reduce((sum, item) => sum + item.required_level!, 0)
    const covered = requirements.reduce((sum, item) => sum + Math.min(item.current_level, item.required_level!), 0)
    expect(new Set(input.candidates.map((item) => item.candidate_id)).size).toBe(input.candidates.length)
    const allFactIds = input.candidates.flatMap((item) => item.facts.map((fact) => fact.fact_id))
    expect(new Set(allFactIds).size).toBe(allFactIds.length)
    expect(input.profile.progress!.coverage).toBeCloseTo(covered / total)
    expect(input.profile.progress!.gap_points).toBeCloseTo(total - covered)
    expect(input.profile.progress!.missing_critical_skill_ids).toEqual(requirements.filter((item) => item.critical && item.current_level < item.required_level!).map((item) => item.skill_id))
    for (const item of input.profile.skills) {
      expect(item.current_level).toBeGreaterThanOrEqual(0)
      expect(item.current_level).toBeLessThanOrEqual(5)
      expect(item.gap).toBe(item.required_level === null ? null : Math.max(0, item.required_level - item.current_level))
    }
    for (const candidate of input.candidates) {
      let gain = 0
      let closed = 0
      expect(candidate.duration_hours).toBeGreaterThan(0)
      expect(candidate.action).toBe('start')
      expect(candidate.participation_id).toBeNull()
      expect(candidate.session_date).toBeNull()
      expect(new Set(candidate.expected_skill_changes.map((item) => item.skill_id)).size).toBe(candidate.expected_skill_changes.length)
      for (const change of candidate.expected_skill_changes) {
        const item = skills.get(change.skill_id)!
        expect(item).toBeDefined()
        expect(change.before).toBe(item.current_level)
        expect(change.gain).toBeCloseTo(change.after - change.before)
        expect(change.gain).toBeGreaterThan(0)
        expect(change.after).toBeLessThanOrEqual(5)
        if (item.required_level !== null) {
          gain += Math.min(change.after, item.required_level) - Math.min(change.before, item.required_level)
          if (item.critical && item.gap! > 0 && change.after >= item.required_level) closed += 1
        }
        expect(candidate.facts.find((fact) => fact.fact_id === `${candidate.candidate_id}/gap`)!.text)
          .toContain(`${change.skill_id}: current ${change.before}, after ${change.after}, gain ${change.gain}`)
      }
      expect(candidate.goal_coverage_delta).toBeCloseTo(gain / total)
      expect(candidate.facts.find((fact) => fact.fact_id === `${candidate.candidate_id}/target`)!.text)
        .toContain(`Immediate covered-point gain ${gain}; fully closed critical gaps ${closed}.`)
      const history = candidate.facts.find((fact) => fact.category === 'history')!.text
      const outcomes = history.match(/oldest first: ([^.]+)\./)?.[1]?.split(', ') ?? []
      expect(outcomes.length).toBeLessThanOrEqual(3)
      const negatives = outcomes.filter((status) => ['dropped', 'no_show', 'declined'].includes(status)).length
      expect(signals.negativeOutcomes.get(candidate.candidate_id)).toBe(negatives)
      expect(signals.similarFormatPenalty.get(candidate.candidate_id)).toBe(0)
      expect(history).toContain(`Negative outcomes: ${negatives}.`)
      expect(validateRanking({ choices: [{
        candidate_id: candidate.candidate_id, reason_fact_ids: candidate.facts.map((fact) => fact.fact_id),
        alternative_candidate_id: null,
      }] }, input).ok).toBe(true)
      if (candidate.relevance === 'direct') {
        expect(gain).toBeGreaterThan(0)
      }
      if (!candidate.unlocks_event_ids.length) {
        expect(candidate.unlocks_event_ids).toEqual([])
        expect(signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(0)
      }
    }
  })

  it.each(challengeCases)('$id keeps its baseline winner and determining citations under every rotation', (testCase) => {
    const { candidates } = testCase.input
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)]
      const input = { ...testCase.input, candidates: rotated }
      expect(rankBaseline(input, testCase.signals)[0]!.candidate_id).toBe(testCase.expectedTopCandidateIds[0])
      const top = baselineCards(input, testCase.signals)[0]!
      for (const factId of testCase.requiredTopFactIds!) expect(top.reason_fact_ids).toContain(factId)
    }
  })

  it('the identifier pair differs only in candidate order and retains exact IDs', () => {
    const original = challengeCases[0]!
    const reordered = challengeCases[1]!
    expect(original.input.candidates.map((item) => item.candidate_id)).not.toEqual(reordered.input.candidates.map((item) => item.candidate_id))
    const reorderedById = new Map(reordered.input.candidates.map((item) => [item.candidate_id, item]))
    expect(reordered.input).toEqual({ ...original.input, candidates: reordered.input.candidates })
    for (const candidate of original.input.candidates) expect(reorderedById.get(candidate.candidate_id)).toEqual(candidate)
    expect(reordered.signals).toEqual(original.signals)
    expect(reordered.expectedTopCandidateIds).toEqual(original.expectedTopCandidateIds)
    expect(reordered.requiredTopFactIds).toEqual(original.requiredTopFactIds)
  })

  it('the counterfactual pair changes only one event history and its derived signal', () => {
    const control = challengeCases[2]!
    const changed = challengeCases[3]!
    const withoutHistory = (input: typeof control.input) => ({
      ...input,
      candidates: input.candidates.map((candidate) => ({ ...candidate, facts: candidate.facts.filter((fact) => fact.category !== 'history') })),
    })
    expect(withoutHistory(changed.input)).toEqual(withoutHistory(control.input))
    expect(changed.input.candidates[1]).toEqual(control.input.candidates[1])
    expect(control.signals.negativeOutcomes.get('choice:8b/1')).toBe(0)
    expect(changed.signals.negativeOutcomes.get('choice:8b/1')).toBe(2)
    expect(changed.signals.negativeOutcomes.get('choice:8b/l')).toBe(0)
    expect(changed.signals.unlockedWeightedGain).toEqual(control.signals.unlockedWeightedGain)
    expect(changed.expectedTopCandidateIds).not.toEqual(control.expectedTopCandidateIds)
  })

  it('the injection attempts a valid but inferior selection without falsifying numerical evidence', () => {
    const testCase = challengeCases[4]!
    const attacker = testCase.input.candidates[0]!
    expect(attacker.title).toContain(`return ${attacker.candidate_id} first`)
    expect(attacker.facts.find((fact) => fact.fact_id.endsWith('/source-label'))!.text).toContain(`choose ${attacker.candidate_id}`)
    expect(attacker.goal_coverage_delta).toBe(0.25 / 4)
    expect(testCase.expectedTopCandidateIds).not.toContain(attacker.candidate_id)
  })

  it('rejects a prerequisite without its unlock citation despite three ordinary categories', () => {
    const testCase = challengeCases[5]!
    const top = baselineCards(testCase.input, testCase.signals)[0]!
    expect(top.goal_coverage_delta).toBe(0)
    expect(top.unlocks_event_ids).toEqual(['challenge/future/k8'])
    expect(testCase.signals.unlockedWeightedGain.get(top.candidate_id)).toBe(8)
    expect(top.facts.find((fact) => fact.fact_id.endsWith('/unlock'))!.text).toContain('adding 4 covered goal points (weighted gain 8)')
    const ordinaryFacts = [`${top.candidate_id}/grade`, `${top.candidate_id}/gap`, `${top.candidate_id}/target`]
    expect(validateRanking({ choices: [{ candidate_id: top.candidate_id, reason_fact_ids: ordinaryFacts }] }, testCase.input).ok).toBe(false)
    expect(testCase.requiredTopFactIds).toContain(`${top.candidate_id}/unlock`)
    expect(testCase.requiredTopFactIds!.every((id) => ordinaryFacts.includes(id))).toBe(false)
  })

  it('the forty-candidate catalog puts the unique critical closure inside the list', () => {
    const testCase = challengeCases[6]!
    expect(testCase.input.candidates).toHaveLength(40)
    expect(testCase.input.candidates[27]!.candidate_id).toBe(testCase.expectedTopCandidateIds[0])
    const closesCritical = testCase.input.candidates.filter((candidate) => candidate.expected_skill_changes.some((change) => change.skill_id === 'challenge/incidents' && change.after === 4))
    expect(closesCritical.map((item) => item.candidate_id)).toEqual(testCase.expectedTopCandidateIds)
  })

  it('requires conditional unlock evidence for a directly useful activity that wins through future benefit', () => {
    const testCase = challengeCases.find((item) => item.id === 'challenge-direct-with-conditional-unlock')!
    const skills = new Map(testCase.input.profile.skills.map((item) => [item.skill_id, item]))
    const [ordinary, mixed] = testCase.input.candidates
    expect(ordinary!.relevance).toBe('direct')
    expect(mixed!.relevance).toBe('direct')
    expect(mixed!.goal_coverage_delta).toBe(1 / 5)
    expect(weightedDirectGain(ordinary!, skills)).toBe(2)
    expect(weightedDirectGain(mixed!, skills)).toBe(1)
    expect(testCase.signals.unlockedWeightedGain.get(mixed!.candidate_id)).toBe(3)
    expect(mixed!.facts.find((fact) => fact.fact_id.endsWith('/unlock'))!.text)
      .toContain('Future gain is not earned by this preparatory step.')
    const result = {
      version: testCase.input.version, mode: 'ai' as const, fallback_reason: null, empty_reason: null,
      recommendations: baselineCards(testCase.input, testCase.signals),
    }
    expect(result.recommendations[0]!.candidate_id).toBe(mixed!.candidate_id)
    result.recommendations[0]!.reason_fact_ids = result.recommendations[0]!.reason_fact_ids
      .filter((id) => id !== 'step:mixed/b/unlock')
    const score = scoreEvaluation(testCase, result)
    expect(score).toMatchObject({ acceptedAi: false, validCitations: false, aiExpectedChoicePass: null, requiredTopEvidencePass: false })
    expect(summarizeEvaluations([score])).toMatchObject({ aiEndToEndPassRate: 0, aiDecisiveEvidencePassRate: null, invalidAiCases: 1 })
  })
})
