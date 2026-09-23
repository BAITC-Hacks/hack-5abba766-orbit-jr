import { describe, expect, it } from 'vitest'
import type { RecommendationResult } from '../../../contracts/backend'
import { evaluationCases, type EvaluationCase } from '../../evaluation/cases'
import { acceptanceCases } from '../../evaluation/acceptance-cases'
import { scoreEvaluation, summarizeEvaluations } from '../../evaluation/metrics'
import { validateRanking } from '../../src/ai/response-validator'
import { baselineCards, rankBaseline } from '../../src/domain/baseline'

function aiResult(testCase: EvaluationCase, ...candidateIds: string[]): RecommendationResult {
  const validated = validateRanking({ choices: candidateIds.map((candidateId) => ({
    candidate_id: candidateId,
    reason_fact_ids: testCase.input.candidates.find((item) => item.candidate_id === candidateId)!.facts.map((fact) => fact.fact_id),
    alternative_candidate_id: null,
  })) }, testCase.input)
  if (!validated.ok) throw new Error(validated.detail)
  return { version: testCase.input.version, mode: 'ai', fallback_reason: null, empty_reason: null, recommendations: validated.cards }
}

describe('authored evaluation scenarios', () => {
  it.each(evaluationCases)('$id has coherent levels, coverage, signals and citable facts', (testCase) => {
    const { input, signals } = testCase
    const skills = new Map(input.profile.skills.map((skill) => [skill.skill_id, skill]))
    const required = input.profile.skills.filter((skill) => skill.required_level !== null)
    const targetSum = required.reduce((sum, skill) => sum + skill.required_level!, 0)
    const covered = required.reduce((sum, skill) => sum + Math.min(skill.current_level, skill.required_level!), 0)
    expect(input.profile.progress!.coverage).toBeCloseTo(covered / targetSum)
    expect(input.profile.progress!.gap_points).toBeCloseTo(targetSum - covered)
    expect(input.profile.progress!.missing_critical_skill_ids).toEqual(required.filter((skill) => skill.critical && skill.current_level < skill.required_level!).map((skill) => skill.skill_id))
    const candidateIds = input.candidates.map((candidate) => candidate.candidate_id)
    expect(new Set(candidateIds).size).toBe(candidateIds.length)
    expect(testCase.expectedTopCandidateIds.every((id) => candidateIds.includes(id))).toBe(true)

    for (const candidate of input.candidates) {
      let goalGain = 0
      for (const change of candidate.expected_skill_changes) {
        const skill = skills.get(change.skill_id)!
        expect(change.before).toBe(skill.current_level)
        expect(change.gain).toBeCloseTo(change.after - change.before)
        expect(change.gain).toBeGreaterThanOrEqual(0)
        expect(change.after).toBeLessThanOrEqual(5)
        if (skill.required_level !== null) {
          goalGain += Math.min(change.after, skill.required_level) - Math.min(change.before, skill.required_level)
        }
      }
      expect(candidate.goal_coverage_delta).toBeCloseTo(goalGain / targetSum)
      expect(signals.negativeOutcomes.get(candidate.candidate_id)).toBeGreaterThanOrEqual(0)
      expect(signals.negativeOutcomes.get(candidate.candidate_id)).toBeLessThanOrEqual(3)
      expect(aiResult(testCase, candidate.candidate_id).recommendations[0]?.candidate_id).toBe(candidate.candidate_id)
    }
  })

  it.each(evaluationCases)('$id satisfies its authored baseline expectation', (testCase) => {
    const top = rankBaseline(testCase.input, testCase.signals)[0]!.candidate_id
    expect(testCase.expectedTopCandidateIds).toContain(top)
  })

  it('prerequisite evidence separates zero immediate coverage from future goal gain', () => {
    const testCase = evaluationCases.find((item) => item.id === 'prerequisite-with-evidence')!
    const candidate = testCase.input.candidates.find((item) => item.candidate_id === 'prepare-design-lab')!
    expect(candidate.goal_coverage_delta).toBe(0)
    expect(candidate.unlocks_event_ids).toEqual(['authored-future/advanced-design-lab'])
    expect(testCase.signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(3)
    expect(candidate.facts.some((fact) => fact.text.includes('weighted gain 3'))).toBe(true)
    const card = baselineCards(testCase.input, testCase.signals)[0]!
    expect(card.candidate_id).toBe(candidate.candidate_id)
    const unlockFact = candidate.facts.find((fact) => fact.text.includes('weighted gain 3'))!
    expect(card.reason_fact_ids).toContain(unlockFact.fact_id)
  })

  it('the validated continuation retains its concrete attempt and past session', () => {
    const testCase = evaluationCases.find((item) => item.id === 'continue-preserves-identity')!
    const result = aiResult(testCase, testCase.expectedTopCandidateIds[0]!)
    expect(result.recommendations[0]).toMatchObject({
      action: 'continue', participation_id: 'authored-attempt/8f6b', session_date: '2026-09-15',
    })
  })
})

describe('evaluation metrics', () => {
  const testCase = evaluationCases[0]!

  it('never counts correct fallback choices as accepted AI quality or AI-baseline agreement', () => {
    const result: RecommendationResult = {
      version: testCase.input.version, mode: 'rules_fallback', fallback_reason: 'missing_api_key',
      empty_reason: null, recommendations: baselineCards(testCase.input, testCase.signals),
    }
    const score = scoreEvaluation(testCase, result)
    expect(score).toMatchObject({ fallback: true, acceptedAi: false, aiExpectedChoicePass: null, aiBaselineAgreement: null, baselineExpectedChoicePass: true, validCitations: true })
    expect(summarizeEvaluations([score])).toMatchObject({
      acceptedAiCases: 0, aiAcceptanceRate: 0, fallbackRate: 1,
      aiExpectedChoicePassRate: null, aiBaselineAgreementRate: null, baselineExpectedChoicePassRate: 1,
    })
  })

  it('distinguishes a valid but poor AI choice from an invalid response', () => {
    const wrong = testCase.input.candidates.find((candidate) => !testCase.expectedTopCandidateIds.includes(candidate.candidate_id))!
    const score = scoreEvaluation(testCase, aiResult(testCase, wrong.candidate_id))
    expect(score).toMatchObject({ acceptedAi: true, validCitations: true, aiExpectedChoicePass: false, aiBaselineAgreement: false, fallback: false })
  })

  it('excludes foreign citations from accepted AI even if the top choice is expected', () => {
    const result = aiResult(testCase, testCase.expectedTopCandidateIds[0]!)
    result.recommendations[0]!.reason_fact_ids[0] = testCase.input.candidates[0]!.facts[0]!.fact_id
    const score = scoreEvaluation(testCase, result)
    expect(score).toMatchObject({ acceptedAi: false, validCitations: false, aiExpectedChoicePass: null, aiBaselineAgreement: null })
    expect(summarizeEvaluations([score]).invalidAiCases).toBe(1)
  })

  it('keeps fallback out of the quality denominator in a mixed evaluation', () => {
    const success = scoreEvaluation(testCase, aiResult(testCase, testCase.expectedTopCandidateIds[0]!))
    const fallback = scoreEvaluation(testCase, {
      version: testCase.input.version, mode: 'rules_fallback', fallback_reason: 'provider_timeout',
      empty_reason: null, recommendations: baselineCards(testCase.input, testCase.signals),
    })
    expect(summarizeEvaluations([success, fallback])).toMatchObject({
      totalCases: 2, acceptedAiCases: 1, fallbackCases: 1, aiAcceptanceRate: 0.5,
      aiExpectedChoicePassRate: 1, aiBaselineAgreementRate: 1, fallbackRate: 0.5,
      aiEndToEndPassRate: 0.5,
    })
  })

  it('does not count an otherwise valid response for an old snapshot as accepted AI', () => {
    const result = aiResult(testCase, testCase.expectedTopCandidateIds[0]!)
    result.version = { ...result.version, employee_revision: result.version.employee_revision + 1 }
    const score = scoreEvaluation(testCase, result)
    expect(score).toMatchObject({ validCitations: true, validSnapshotVersion: false, acceptedAi: false, aiExpectedChoicePass: null, aiBaselineAgreement: null })
    expect(summarizeEvaluations([score])).toMatchObject({ invalidAiCases: 1, aiEndToEndPassRate: 0 })
  })

  it('fails the explanation when a correct choice omits the decisive prerequisite fact', () => {
    const prerequisite = evaluationCases.find((item) => item.id === 'prerequisite-with-evidence')!
    const result = aiResult(prerequisite, prerequisite.expectedTopCandidateIds[0]!)
    result.recommendations[0]!.reason_fact_ids = result.recommendations[0]!.reason_fact_ids
      .filter((id) => !prerequisite.requiredTopFactIds!.includes(id))
    const score = scoreEvaluation(prerequisite, result)
    expect(score).toMatchObject({ acceptedAi: true, validCitations: true, aiExpectedChoicePass: true, requiredTopEvidencePass: false })
    expect(summarizeEvaluations([score])).toMatchObject({ aiEndToEndPassRate: 0, aiDecisiveEvidencePassRate: 0 })
  })

  it('only measures decisive evidence when the case defines it', () => {
    const unlabelled = scoreEvaluation(testCase, aiResult(testCase, testCase.expectedTopCandidateIds[0]!))
    expect(unlabelled.requiredTopEvidencePass).toBeNull()
    expect(summarizeEvaluations([unlabelled]).aiDecisiveEvidencePassRate).toBeNull()
    const labelled = evaluationCases.find((item) => item.id === 'prerequisite-with-evidence')!
    const score = scoreEvaluation(labelled, aiResult(labelled, labelled.expectedTopCandidateIds[0]!))
    expect(summarizeEvaluations([unlabelled, score])).toMatchObject({ aiDecisiveEvidencePassRate: 1, aiEndToEndPassRate: 1 })
  })

  it('requires history evidence when history breaks the ranking tie', () => {
    const historyCase = evaluationCases.find((item) => item.id === 'history-breaks-tie')!
    expect(historyCase.requiredTopFactIds).toEqual(['new-format/history'])
    const result = aiResult(historyCase, 'new-format')
    result.recommendations[0]!.reason_fact_ids = result.recommendations[0]!.reason_fact_ids
      .filter((id) => id !== 'new-format/history')
    const score = scoreEvaluation(historyCase, result)
    expect(score).toMatchObject({ acceptedAi: true, aiExpectedChoicePass: true, requiredTopEvidencePass: false })
    expect(summarizeEvaluations([score]).aiEndToEndPassRate).toBe(0)
  })

  it.each([1, 2, 3])('accepts the explicitly authored prefix when %i cards are returned', (count) => {
    const orderedCase = acceptanceCases.find((item) => item.id === 'acceptance-multiple-cards')!
    const result = aiResult(orderedCase, ...['option:9c/b', 'option:9c/d', 'option:9c/c'].slice(0, count))
    const score = scoreEvaluation(orderedCase, result)
    expect(score).toMatchObject({ acceptedAi: true, aiExpectedChoicePass: true, expectedCandidateOrderPass: true })
    expect(summarizeEvaluations([score])).toMatchObject({ aiCandidateOrderPassRate: 1, aiEndToEndPassRate: 1 })
  })

  it.each([2, 3])('rejects inferior later choices among %i valid cards even with the correct first choice', (count) => {
    const orderedCase = acceptanceCases.find((item) => item.id === 'acceptance-multiple-cards')!
    const result = aiResult(orderedCase, ...['option:9c/b', 'option:9c/c', 'option:9c/d'].slice(0, count))
    const score = scoreEvaluation(orderedCase, result)
    expect(score).toMatchObject({ acceptedAi: true, validCitations: true, aiExpectedChoicePass: true, expectedCandidateOrderPass: false })
    expect(summarizeEvaluations([score])).toMatchObject({ aiCandidateOrderPassRate: 0, aiEndToEndPassRate: 0 })
  })

  it('does not infer a complete order for cases labelled only by their top choice', () => {
    const score = scoreEvaluation(testCase, aiResult(testCase, testCase.expectedTopCandidateIds[0]!))
    expect(score.expectedCandidateOrderPass).toBeNull()
    expect(summarizeEvaluations([score]).aiCandidateOrderPassRate).toBeNull()
  })

  it('reports unavailable rates for an empty run', () => {
    expect(summarizeEvaluations([])).toMatchObject({ totalCases: 0, aiAcceptanceRate: null, fallbackRate: null, aiExpectedChoicePassRate: null, baselineExpectedChoicePassRate: null })
  })

  it('counts invalid provider output even after orchestration converts it to fallback', () => {
    const score = scoreEvaluation(testCase, {
      version: testCase.input.version, mode: 'rules_fallback', fallback_reason: 'invalid_response',
      empty_reason: null, recommendations: baselineCards(testCase.input, testCase.signals),
    })
    expect(score.fallbackReason).toBe('invalid_response')
    expect(summarizeEvaluations([score])).toMatchObject({
      invalidAiCases: 1, fallbackCases: 1, acceptedAiCases: 0, aiEndToEndPassRate: 0,
    })
  })
})
