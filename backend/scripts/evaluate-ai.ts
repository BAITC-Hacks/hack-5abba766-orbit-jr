import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import type { RecommendationResult } from '../../contracts/backend'
import { evaluationCases } from '../evaluation/cases'
import { domainEvaluationCases, domainEmptyCases } from '../evaluation/domain-cases'
import { scoreEvaluation, summarizeEvaluations } from '../evaluation/metrics'
import { parseEvaluationOptions, resolveEvaluationSuites, summarizeLatencies } from '../evaluation/options'
import { getModel, getTimeoutMs, isAiConfigured } from '../src/ai/adapter'
import { buildUserMessage, RANKING_JSON_SCHEMA, SYSTEM_PROMPT } from '../src/ai/prompt'
import { recommend } from '../src/ai/recommend'
import { baselineCards } from '../src/domain/baseline'

export async function evaluateAi(args: readonly string[]): Promise<0 | 1> {
  const options = parseEvaluationOptions(args)
  const { live, json, repeat, suite } = options
  // The backend command loads ../.env with Node's --env-file-if-exists option.
  // Offline mode must not call a provider even when credentials are configured.
  if (live && !isAiConfigured()) {
    throw new Error('Live evaluation requires both LLM_API_KEY and LLM_MODEL in the repository .env or process environment')
  }

  const timestamp = new Date().toISOString()
  const selectedSuites = resolveEvaluationSuites(suite)
  const regression = selectedSuites.includes('regression')
    ? evaluationCases.map((testCase) => ({ testCase, suite: 'regression' as const }))
    : []
  const challenge = selectedSuites.includes('challenge')
    ? (await import('../evaluation/challenge-cases')).challengeCases.map((testCase) => ({ testCase, suite: 'challenge' as const }))
    : []
  const acceptance = selectedSuites.includes('acceptance')
    ? (await import('../evaluation/acceptance-cases')).acceptanceCases.map((testCase) => ({ testCase, suite: 'acceptance' as const }))
    : []
  const domain = selectedSuites.includes('domain')
    ? domainEvaluationCases.map((testCase) => ({ testCase, suite: 'domain' as const }))
    : []
  const selected = [...regression, ...challenge, ...acceptance, ...domain]
  const cases = options.smoke ? selected.slice(0, 1) : selected
  if (!cases.length) throw new Error('The selected evaluation suite has no authored cases')
  const includesDomain = cases.some(item => item.suite === 'domain')
  const rows = []
  for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex++) {
    for (const { testCase, suite: caseSuite } of cases) {
      if (live && !json) console.error(`[${rows.length + 1}/${cases.length * repeat}] ${testCase.id}, repetition ${repeatIndex}/${repeat}`)
      const started = performance.now()
      const result: RecommendationResult = live
        ? await recommend(testCase.input, { signals: testCase.signals })
        : {
          version: testCase.input.version, mode: 'rules_fallback',
          fallback_reason: 'missing_api_key', empty_reason: null,
          recommendations: baselineCards(testCase.input, testCase.signals),
        }
      const recommendationLatencyMs = performance.now() - started
      const score = scoreEvaluation(testCase, result)
      rows.push({
        ...score,
        suite: caseSuite,
        repeatIndex,
        candidateCount: testCase.input.candidates.length,
        recommendationLatencyMs,
        payloadBytes: Buffer.byteLength(buildUserMessage(testCase.input, testCase.signals), 'utf8'),
        selectedChoices: result.recommendations.map((card) => ({
          candidate_id: card.candidate_id,
          reason_fact_ids: card.reason_fact_ids,
        })),
        fallbackReason: live ? result.fallback_reason : null,
      })
    }
  }
  const scored = summarizeEvaluations(rows)
  const emptyChecks = []
  // Domain empty states are deterministic checks, excluded from ranking-quality and latency denominators.
  for (const testCase of includesDomain ? domainEmptyCases : []) {
    const result = await recommend(testCase.input, { signals: testCase.signals, emptyReason: testCase.expectedEmptyReason })
    emptyChecks.push({ caseId: testCase.id, expectedEmptyReason: testCase.expectedEmptyReason,
      actualEmptyReason: result.empty_reason,
      pass: result.mode === 'no_candidates' && result.empty_reason === testCase.expectedEmptyReason &&
        result.recommendations.length === 0 && result.fallback_reason === null &&
        result.version.dataset_revision === testCase.input.version.dataset_revision &&
        result.version.employee_revision === testCase.input.version.employee_revision })
  }
  const summary = live ? scored : {
    ...scored,
    acceptedAiCases: 0,
    invalidAiCases: 0,
    fallbackCases: 0,
    noCandidatesCases: 0,
    aiAcceptanceRate: null,
    aiExpectedChoicePassRate: null,
    aiBaselineAgreementRate: null,
    aiEndToEndPassRate: null,
    aiDecisiveEvidencePassRate: null,
    aiCandidateOrderPassRate: null,
    fallbackRate: null,
  }
  const report = {
    run: live ? 'live' : 'baseline_only',
    model: live ? getModel() : null,
    suite,
    suitesIncluded: [...new Set(cases.map((item) => item.suite))],
    repetitions: repeat,
    smoke: options.smoke,
    timestamp,
    providerBudgetMs: getTimeoutMs(),
    promptSha256: createHash('sha256').update(SYSTEM_PROMPT).digest('hex'),
    schemaSha256: createHash('sha256').update(JSON.stringify(RANKING_JSON_SCHEMA)).digest('hex'),
    casesSha256: createHash('sha256').update(JSON.stringify(cases.map(({ testCase }) => ({
      id: testCase.id,
      input: testCase.input,
      expectedTopCandidateIds: testCase.expectedTopCandidateIds,
      expectedCandidateOrder: testCase.expectedCandidateOrder,
      requiredTopFactIds: testCase.requiredTopFactIds,
      signals: {
        negativeOutcomes: [...testCase.signals.negativeOutcomes],
        unlockedWeightedGain: [...testCase.signals.unlockedWeightedGain],
        similarFormatPenalty: [...testCase.signals.similarFormatPenalty],
      },
    })))).digest('hex'),
    dataset: 'authored synthetic cases; not official or hidden judge profiles',
    qualityScope: 'top-ranked choice and decisive evidence; full returned order only where expectedCandidateOrder is authored, otherwise other cards are validated for identifiers and citations only',
    comparisonScope: 'agreement with authored rules; baseline agreement does not establish an AI benefit',
    coverage: includesDomain
      ? 'includes validated source profiles and history through the actual domain candidate pipeline'
      : 'hand-authored ranking snapshots',
    recommendationLatencyScope: 'live: recommendation call including baseline preparation and provider validation; baseline_only: deterministic baseline card generation; excludes source validation, domain candidate generation, HTTP, database and browser latency',
    emptyCheckScope: 'deterministic domain empty states, run once and excluded from ranking scores and latency samples',
    emptyChecks,
    summary,
    recommendationLatencyMs: summarizeLatencies(rows.map((row) => row.recommendationLatencyMs)),
    cases: rows.map((row) => ({
      ...row, mode: live ? row.mode : 'baseline_only', fallback: live ? row.fallback : null,
    })),
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`${report.run}: ${suite} (${report.suitesIncluded.join(', ')}), ${cases.length} authored cases × ${repeat}; ${live ? `model ${report.model}` : 'no provider calls'}; ${timestamp}`)
    console.table(report.cases.map((row) => ({
      case: row.caseId, suite: row.suite, repeat: row.repeatIndex,
      candidates: row.candidateCount, mode: row.mode, top: row.topCandidateId,
      baselinePass: row.baselineExpectedChoicePass,
      aiPass: row.aiExpectedChoicePass ?? 'not measured',
      decisiveEvidence: row.requiredTopEvidencePass ?? 'not required',
      candidateOrder: row.expectedCandidateOrderPass ?? 'not measured',
      citations: row.validCitations, version: row.validSnapshotVersion,
      ms: Math.round(row.recommendationLatencyMs), bytes: row.payloadBytes,
      fallback: row.fallbackReason ?? '-',
    })))
    for (const row of report.cases) {
      console.log(`${row.caseId} [${row.repeatIndex}]: ${JSON.stringify(row.selectedChoices)}`)
    }
    console.log(JSON.stringify({ summary, recommendationLatencyMs: report.recommendationLatencyMs,
      recommendationLatencyScope: report.recommendationLatencyScope, emptyChecks }, null, 2))
    console.log(`promptSha256=${report.promptSha256}; schemaSha256=${report.schemaSha256}; casesSha256=${report.casesSha256}`)
    console.log('This measures authored top-choice expectations and recommendation-call latency, not product impact, HTTP latency or judge performance. Agreement with the rules baseline does not establish an AI benefit.')
  }
  if (rows.some((row) => !row.baselineExpectedChoicePass || !row.validCitations || !row.validSnapshotVersion
    || row.requiredTopEvidencePass === false || row.expectedCandidateOrderPass === false)) return 1
  if (emptyChecks.some(check => !check.pass)) return 1
  if (live && rows.some((row) => !row.acceptedAi || row.aiExpectedChoicePass !== true
    || row.recommendationLatencyMs > 10_000)) {
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluateAi(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode }).catch((error: unknown) => {
    // Provider error text and source snapshots must not become terminal output.
    console.error(error instanceof Error ? error.message : 'Evaluation failed')
    process.exitCode = 1
  })
}
