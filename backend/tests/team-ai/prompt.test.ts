import { describe, expect, it } from 'vitest'
import { evaluationCases } from '../../evaluation/cases'
import { buildUserMessage } from '../../src/ai/prompt'
import { candidateRankingFactors } from '../../src/domain/baseline'

describe('ranking context', () => {
  it.each(evaluationCases)('$id shares exactly the comparator arithmetic without leaking the expected answer', (testCase) => {
    const raw = buildUserMessage(testCase.input, testCase.signals)
    const payload = JSON.parse(raw)
    const skills = new Map(testCase.input.profile.skills.map((skill) => [skill.skill_id, skill]))
    for (const [index, candidate] of testCase.input.candidates.entries()) {
      expect(payload.candidates[index].ranking_factors).toEqual(candidateRankingFactors(candidate, skills, testCase.signals))
    }
    expect(payload).not.toHaveProperty('expectedTopCandidateIds')
    expect(payload).not.toHaveProperty('requiredTopFactIds')
    expect(payload.candidates.map((candidate: { candidate_id: string }) => candidate.candidate_id))
      .toEqual(testCase.input.candidates.map((candidate) => candidate.candidate_id))
  })

  it('separates zero immediate progress from discounted future benefit', () => {
    const testCase = evaluationCases.find((item) => item.id === 'prerequisite-with-evidence')!
    const payload = JSON.parse(buildUserMessage(testCase.input, testCase.signals))
    expect(payload.candidates[1]).toMatchObject({
      goal_coverage_delta: 0,
      ranking_factors: { weighted_direct_gain: 0, best_unlocked_weighted_gain: 3, weighted_target_value: 1.5 },
    })
    expect(payload.candidates[0].ranking_factors.weighted_target_value).toBe(1)
  })

  it('does not project an employee name, raw history or extra fields into the request', () => {
    const testCase = evaluationCases[0]!
    const state = structuredClone(testCase.input)
    Object.assign(state.profile, { full_name: 'Private person', history: [{ private: true }], manager: 'Private manager' })
    Object.assign(state.candidates[0]!, { source_description: 'Private source text' })
    const raw = buildUserMessage(state, testCase.signals)
    expect(raw).not.toContain('Private')
    expect(JSON.parse(raw).profile).not.toHaveProperty('history')
  })
})
