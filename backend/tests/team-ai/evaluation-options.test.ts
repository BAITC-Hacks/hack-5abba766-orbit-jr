import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluationCases } from '../../evaluation/cases'
import { acceptanceCases } from '../../evaluation/acceptance-cases'
import { domainEvaluationCases, domainEmptyCases } from '../../evaluation/domain-cases'
import { parseEvaluationOptions, resolveEvaluationSuites, summarizeLatencies } from '../../evaluation/options'
import { evaluateAi } from '../../scripts/evaluate-ai'

describe('evaluation CLI options', () => {
  it('defaults to one offline regression run', () => {
    expect(parseEvaluationOptions([])).toEqual({ live: false, smoke: false, json: false, suite: 'regression', repeat: 1 })
  })

  it('accepts a repeated live challenge run and JSON output', () => {
    expect(parseEvaluationOptions(['--suite=challenge', '--repeat=5', '--live', '--json'])).toEqual({ live: true, smoke: false, json: true, suite: 'challenge', repeat: 5 })
  })

  it('accepts all suites offline and explicit single-call smoke mode', () => {
    expect(parseEvaluationOptions(['--suite=all', '--repeat=2']).live).toBe(false)
    expect(parseEvaluationOptions(['--smoke', '--live', '--repeat=1']).repeat).toBe(1)
  })

  it('accepts the separate acceptance suite offline and live', () => {
    expect(parseEvaluationOptions(['--suite=acceptance', '--json'])).toEqual({ live: false, smoke: false, json: true, suite: 'acceptance', repeat: 1 })
    expect(parseEvaluationOptions(['--suite=acceptance', '--live', '--repeat=3'])).toEqual({ live: true, smoke: false, json: false, suite: 'acceptance', repeat: 3 })
  })

  it('accepts the comparison suite for repeated before/after runs', () => {
    expect(parseEvaluationOptions(['--suite=comparison', '--repeat=3', '--live', '--json'])).toEqual({ live: true, smoke: false, json: true, suite: 'comparison', repeat: 3 })
  })

  it('accepts the additive domain suite without changing the default suite', () => {
    expect(parseEvaluationOptions(['--suite=domain', '--repeat=2', '--json'])).toEqual({ live: false, smoke: false, json: true, suite: 'domain', repeat: 2 })
    expect(parseEvaluationOptions([]).suite).toBe('regression')
  })

  it.each([
    ['--unknown'], ['--live=true'], ['--json=false'], ['--suite'], ['--suite='],
    ['--suite=official'], ['--repeat'], ['--repeat=0'], ['--repeat=6'],
    ['--repeat=1.5'], ['--repeat=-1'], ['--repeat=01'], ['--repeat=Infinity'],
    ['--repeat=2x'], ['--repeat=2=3'], ['--suite=regression=challenge'],
    ['--live', '--live'], ['--json', '--json'], ['--smoke', '--smoke'],
    ['--suite=regression', '--suite=challenge'], ['--repeat=1', '--repeat=2'],
    ['--suite=acceptance', '--suite=all'], ['--suite=acceptance', '--suite=acceptance'],
    ['--suite=comparison', '--suite=all'], ['--suite=comparison', '--suite=comparison'],
    ['--smoke'], ['--smoke', '--repeat=1'], ['--live', '--smoke', '--repeat=2'],
  ])('rejects malformed, duplicated or contradictory arguments: %j', (...args) => {
    expect(() => parseEvaluationOptions(args)).toThrow()
  })
})

describe('evaluation suite membership', () => {
  it('includes acceptance and domain in all while preserving the original comparison membership', () => {
    expect(resolveEvaluationSuites('all')).toEqual(['regression', 'challenge', 'acceptance', 'domain'])
    expect(resolveEvaluationSuites('comparison')).toEqual(['regression', 'challenge'])
  })

  it.each(['regression', 'challenge', 'acceptance', 'domain'] as const)('runs %s alone when explicitly selected', (suite) => {
    expect(resolveEvaluationSuites(suite)).toEqual([suite])
  })
})

describe('recommendation latency summaries', () => {
  it('returns null values when no calls were measured', () => {
    expect(summarizeLatencies([])).toEqual({ p50: null, p95: null, max: null })
  })

  it('keeps the exact single-call latency and zero samples', () => {
    expect(summarizeLatencies([0.25])).toEqual({ p50: 0.25, p95: 0.25, max: 0.25 })
    expect(summarizeLatencies([0])).toEqual({ p50: 0, p95: 0, max: 0 })
  })

  it('uses nearest rank rather than interpolation and sorts numerically without mutation', () => {
    const samples = [100, 2, 20, 1]
    expect(summarizeLatencies(samples)).toEqual({ p50: 2, p95: 100, max: 100 })
    expect(samples).toEqual([100, 2, 20, 1])
    expect(summarizeLatencies(Array.from({ length: 20 }, (_, index) => index + 1))).toEqual({ p50: 10, p95: 19, max: 20 })
  })

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid latency %s', (value) => {
    expect(() => summarizeLatencies([value])).toThrow('finite nonnegative')
  })
})

describe('evaluation execution and exit status', () => {
  const fetchMock = vi.fn()
  let printed: string[]
  beforeEach(() => {
    printed = []
    vi.spyOn(console, 'log').mockImplementation((message: string) => { printed.push(message) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('LLM_API_KEY', 'synthetic-evaluation-key')
    vi.stubEnv('LLM_MODEL', 'synthetic-evaluation-model')
    vi.stubEnv('LLM_API_URL', 'https://provider.invalid/chat/completions')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const report = () => JSON.parse(printed[printed.length - 1]!)
  const respondWith = (output: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
  })))
  const choiceFor = (candidateId: string) => ({ choices: [{
    candidate_id: candidateId,
    reason_fact_ids: evaluationCases[0]!.input.candidates.find((candidate) => candidate.candidate_id === candidateId)!.facts.map((fact) => fact.fact_id),
    alternative_candidate_id: null,
  }] })

  it('runs every suite repeatedly offline without sending configured credentials or measuring AI', async () => {
    fetchMock.mockRejectedValue(new Error('Offline evaluation must never call a provider'))
    expect(await evaluateAi(['--suite=all', '--repeat=2', '--json'])).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(report()).toMatchObject({
      run: 'baseline_only', model: null, repetitions: 2,
      suitesIncluded: ['regression', 'challenge', 'acceptance', 'domain'],
      summary: { totalCases: 46, baselineExpectedChoicePassRate: 1, aiAcceptanceRate: null, aiEndToEndPassRate: null, aiCandidateOrderPassRate: null, fallbackRate: null },
    })
    expect(report().cases.every((row: { mode: string; fallback: boolean | null; validSnapshotVersion: boolean }) =>
      row.mode === 'baseline_only' && row.fallback === null && row.validSnapshotVersion)).toBe(true)
    for (const name of ['promptSha256', 'schemaSha256', 'casesSha256']) expect(report()[name]).toMatch(/^[a-f0-9]{64}$/)
    expect(report().emptyChecks).toHaveLength(domainEmptyCases.length)
    expect(report().emptyChecks.every((check: { pass: boolean }) => check.pass)).toBe(true)
    expect(report().recommendationLatencyScope).toContain('excludes source validation, domain candidate generation, HTTP, database and browser latency')
    expect(printed.join('\n')).not.toContain('synthetic-evaluation-key')
  })

  it('keeps domain empty states separate from repeated ranking scores and uses no provider offline', async () => {
    fetchMock.mockRejectedValue(new Error('Offline evaluation must never call a provider'))
    expect(await evaluateAi(['--suite=domain', '--repeat=2', '--json'])).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(report()).toMatchObject({
      suite: 'domain', suitesIncluded: ['domain'], repetitions: 2,
      summary: { totalCases: domainEvaluationCases.length * 2, noCandidatesCases: 0, aiAcceptanceRate: null },
    })
    expect(report().emptyChecks).toHaveLength(2)
    expect(report().emptyChecks.map((check: { caseId: string }) => check.caseId)).toEqual(domainEmptyCases.map(testCase => testCase.id))
    expect(report().cases.every((row: { candidateCount: number }) => row.candidateCount > 0)).toBe(true)
    expect(report().emptyCheckScope).toContain('excluded from ranking scores and latency samples')
  })

  it('retains the original default regression set without domain empty checks', async () => {
    expect(await evaluateAi(['--json'])).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(report().summary.totalCases).toBe(evaluationCases.length)
    expect(report().suitesIncluded).toEqual(['regression'])
    expect(report().emptyChecks).toEqual([])
  })

  it('returns success only for an accepted, correctly ranked live smoke response', async () => {
    respondWith(choiceFor(evaluationCases[0]!.expectedTopCandidateIds[0]!))
    expect(await evaluateAi(['--live', '--smoke', '--json'])).toBe(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(report().summary).toMatchObject({ acceptedAiCases: 1, aiEndToEndPassRate: 1 })
  })

  it('fails a syntactically valid but inferior AI choice', async () => {
    const testCase = evaluationCases[0]!
    const wrong = testCase.input.candidates.find((candidate) => !testCase.expectedTopCandidateIds.includes(candidate.candidate_id))!
    respondWith(choiceFor(wrong.candidate_id))
    expect(await evaluateAi(['--live', '--smoke', '--json'])).toBe(1)
    expect(report().summary).toMatchObject({ acceptedAiCases: 1, invalidAiCases: 0, aiExpectedChoicePassRate: 0, aiEndToEndPassRate: 0 })
  })

  it('fails invalid provider output even when fallback chooses the expected activity', async () => {
    respondWith({ choices: [{ candidate_id: 'invented', reason_fact_ids: ['invented/fact'] }] })
    expect(await evaluateAi(['--live', '--smoke', '--json'])).toBe(1)
    expect(report().summary).toMatchObject({ acceptedAiCases: 0, invalidAiCases: 1, fallbackCases: 1, aiExpectedChoicePassRate: null, aiEndToEndPassRate: 0 })
    expect(report().cases[0]).toMatchObject({ topCandidateId: evaluationCases[0]!.expectedTopCandidateIds[0], fallbackReason: 'invalid_response' })
  })

  it.each([2, 3])('fails %i cards with a correct winner but wrongly ordered later choices', async (count) => {
    for (const testCase of acceptanceCases) {
      const ids = testCase.expectedCandidateOrder
        ? ['option:9c/b', 'option:9c/c', 'option:9c/d'].slice(0, count)
        : testCase.expectedTopCandidateIds
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ choices: ids.map((candidateId) => ({
          candidate_id: candidateId,
          reason_fact_ids: testCase.input.candidates.find((candidate) => candidate.candidate_id === candidateId)!.facts.map((fact) => fact.fact_id),
          alternative_candidate_id: null,
        })) }) },
      }] })))
    }
    expect(await evaluateAi(['--live', '--suite=acceptance', '--json'])).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(report().summary).toMatchObject({
      acceptedAiCases: 2, aiExpectedChoicePassRate: 1, aiCandidateOrderPassRate: 0, aiEndToEndPassRate: 0.5,
    })
    expect(report().cases[1]).toMatchObject({ validCitations: true, aiExpectedChoicePass: true, expectedCandidateOrderPass: false })
  })
})
