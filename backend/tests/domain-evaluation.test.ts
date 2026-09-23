import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { domainEmptyCases, domainEvaluationCases, type DomainEvaluationCase } from '../evaluation/domain-cases'
import { scoreEvaluation } from '../evaluation/metrics'
import { recommend } from '../src/ai/recommend'
import { assertCompletionAllowed, employeeView, getCandidates, skillChanges } from '../src/domain'
import { rankBaseline } from '../src/domain/baseline'
import { validateRelations } from '../src/validation'
import type { Candidate, DatasetSnapshot } from '../src/types'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubEnv('LLM_API_KEY', 'authored-evaluation-not-a-real-key')
  vi.stubEnv('LLM_MODEL', 'authored-evaluation-model')
  vi.stubEnv('LLM_API_URL', 'https://provider.invalid/authored-evaluation')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function choice(candidate: Candidate) {
  return {
    candidate_id: candidate.candidate_id,
    reason_fact_ids: candidate.facts.filter(fact => ['grade', 'skill_gap', 'history', 'target_requirement'].includes(fact.category)).map(fact => fact.fact_id),
    alternative_candidate_id: null,
  }
}
function respond(output: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}
function caseById(id: string): DomainEvaluationCase {
  const testCase = domainEvaluationCases.find(item => item.id === id)
  if (!testCase) throw new Error(`Unknown authored case ${id}`)
  return testCase
}
function completeInMemory(testCase: DomainEvaluationCase, candidate: Candidate): DatasetSnapshot {
  const { snapshot, employeeId } = testCase
  const target = assertCompletionAllowed(snapshot, employeeId, {
    simulation: true, expected_version: testCase.input.version,
    target: candidate.action === 'continue'
      ? { kind: 'existing_participation', participation_id: candidate.participation_id! }
      : { kind: 'new_participation', event_id: candidate.event_id, session_date: candidate.session_date },
  })
  return {
    ...snapshot,
    employee_revisions: { ...snapshot.employee_revisions, [employeeId]: snapshot.employee_revisions[employeeId] + 1 },
    global_revision: snapshot.global_revision + 1,
    completions: [...snapshot.completions, {
      id: 'authored-completion', employee_id: employeeId, ...target,
      applied_as_of: snapshot.as_of_date, recorded_at: '2026-10-01T12:00:00.000Z', sequence: 1,
    }],
  }
}

describe('authored source → domain → actual recommendation adapter', () => {
  it.each(domainEvaluationCases)('$id: ranks validated source-derived candidates and accepts only their real facts', async testCase => {
    expect(validateRelations(testCase.snapshot)).toEqual([])
    expect(testCase.input.candidates).toEqual(getCandidates(testCase.snapshot, testCase.employeeId).candidates)
    const baseline = rankBaseline(testCase.input, testCase.signals)
    expect(testCase.expectedTopCandidateIds).toContain(baseline[0].candidate_id)

    const selected = testCase.input.candidates.find(candidate => candidate.candidate_id === testCase.expectedTopCandidateIds[0])!
    respond({ choices: [choice(selected)] })
    const result = await recommend(testCase.input, { signals: testCase.signals })
    expect(result).toMatchObject({ mode: 'ai', version: testCase.input.version, fallback_reason: null })
    expect(scoreEvaluation(testCase, result)).toMatchObject({
      acceptedAi: true, validCitations: true, validSnapshotVersion: true,
      aiExpectedChoicePass: true, baselineExpectedChoicePass: true,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const request = fetchMock.mock.calls[0][1]!
    const payload = JSON.parse(String(request.body))
    const sent = JSON.parse(payload.messages[1].content)
    expect(sent.candidates.map((candidate: { candidate_id: string }) => candidate.candidate_id))
      .toEqual(testCase.input.candidates.map(candidate => candidate.candidate_id))
    expect(payload.messages[1].content).not.toContain(testCase.snapshot.employees[0].full_name)
    expect(result.recommendations[0].expected_skill_changes).toEqual(selected.expected_skill_changes)
  })

  it.each(domainEvaluationCases)('$id: actual completion earns exactly the advertised independent effect', testCase => {
    const before = employeeView(testCase.snapshot, testCase.employeeId)
    for (const candidate of testCase.input.candidates) {
      const afterSnapshot = completeInMemory(testCase, candidate)
      const after = employeeView(afterSnapshot, testCase.employeeId)
      expect(skillChanges(before, after)).toEqual(candidate.expected_skill_changes)
      expect(after.progress!.coverage - before.progress!.coverage).toBeCloseTo(candidate.goal_coverage_delta, 12)
      expect(after.has_simulated_progress).toBe(true)
      expect(getCandidates(afterSnapshot, testCase.employeeId).candidates.some(item => item.candidate_id === candidate.candidate_id)).toBe(false)
    }
  })

  it.each(['unknown candidate', 'invented fact', 'another candidate fact'] as const)('falls back on %s from a controlled provider response', async corruption => {
    const testCase = caseById('domain-imported-identifiers')
    const [first, second] = testCase.input.candidates
    const invalid = choice(first)
    if (corruption === 'unknown candidate') invalid.candidate_id = 'untrusted/invented-candidate'
    else if (corruption === 'invented fact') invalid.reason_fact_ids[0] = 'untrusted/invented-fact'
    else invalid.reason_fact_ids[0] = second.facts.find(fact => fact.category === 'grade')!.fact_id
    respond({ choices: [invalid] })
    const result = await recommend(testCase.input, { signals: testCase.signals })
    expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' })
    expect(testCase.expectedTopCandidateIds).toContain(result.recommendations[0].candidate_id)
    expect(scoreEvaluation(testCase, result)).toMatchObject({ acceptedAi: false, aiExpectedChoicePass: null, validCitations: true })
  })

  it.each(domainEmptyCases)('$id: returns the domain reason without a provider request', async testCase => {
    const result = await recommend(testCase.input, { signals: testCase.signals, emptyReason: testCase.expectedEmptyReason })
    expect(result).toEqual({
      version: testCase.input.version, mode: 'no_candidates', recommendations: [],
      fallback_reason: null, empty_reason: testCase.expectedEmptyReason,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not admit an unrelated event or an event reserved for the future role', () => {
    expect(caseById('domain-critical-gap').input.candidates.map(candidate => candidate.event_id)).not.toContain('entirely-off-goal')
    const roleSwitch = caseById('domain-role-switch-eligibility')
    expect(roleSwitch.input.profile.goal.target?.target_role).toBe('Data Analyst')
    expect(roleSwitch.input.profile.role).toBe('Research Engineer')
    expect(roleSwitch.input.candidates.map(candidate => candidate.event_id)).toEqual(['current-role-bridge'])
  })

  it('keeps the identity and past date of an existing enrollment after grade change', () => {
    const testCase = caseById('domain-continue-identity')
    const candidate = testCase.input.candidates.find(item => item.event_id === 'old-enrollment')!
    expect(candidate).toMatchObject({ action: 'continue', participation_id: 'authored/history-4', session_date: '2026-09-14' })
    const after = employeeView(completeInMemory(testCase, candidate), testCase.employeeId)
    expect(after.history.find(row => row.participation_id === 'authored/history-4'))
      .toMatchObject({ effective_status: 'completed', completion_origin: 'simulation', scheduled_session_date: '2026-09-14' })
  })

  it('documents numeric future benefit while completion awards only the preparation effect', () => {
    const testCase = caseById('domain-prerequisite-benefit')
    const candidate = testCase.input.candidates.find(item => item.event_id === 'prepare-tooling')!
    expect(candidate).toMatchObject({ relevance: 'prerequisite', goal_coverage_delta: 0, unlocks_event_ids: ['future-design-lab'] })
    expect(testCase.signals.unlockedWeightedGain.get(candidate.candidate_id)).toBe(3)
    const futureFact = candidate.facts.find(fact => fact.fact_id === `${candidate.candidate_id}:unlock:future-design-lab`)
    expect(futureFact?.category).toBe('target_requirement')
    expect(futureFact?.text).toContain('future-design-lab')
    expect(futureFact?.text).toMatch(/2\s*→\s*5/)
    const afterSnapshot = completeInMemory(testCase, candidate)
    const after = employeeView(afterSnapshot, testCase.employeeId)
    expect(after.skills.find(skill => skill.skill_id === 'TOOLING')?.current_level).toBe(1)
    expect(after.skills.find(skill => skill.skill_id === 'DESIGN')?.current_level).toBe(2)
    expect(getCandidates(afterSnapshot, testCase.employeeId).candidates.map(item => item.event_id)).toContain('future-design-lab')
  })
})
