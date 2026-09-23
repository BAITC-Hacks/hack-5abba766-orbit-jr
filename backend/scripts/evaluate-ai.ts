import { performance } from 'node:perf_hooks'
import type { RecommendationResult } from '../../contracts/backend'
import { evaluationCases } from '../evaluation/cases'
import { scoreEvaluation, summarizeEvaluations } from '../evaluation/metrics'
import { getModel, getTimeoutMs, isAiConfigured } from '../src/ai/adapter'
import { buildUserMessage } from '../src/ai/prompt'
import { recommend } from '../src/ai/recommend'
import { baselineCards } from '../src/domain/baseline'

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  if ([...args].some((arg) => !['--live', '--smoke', '--json'].includes(arg))) {
    throw new Error('Usage: npm run eval:ai -- [--live] [--smoke] [--json]')
  }
  const live = args.has('--live')
  if (args.has('--smoke') && !live) throw new Error('--smoke requires --live')
  // The backend workspace command uses Node 24's --env-file-if-exists=../.env.
  // Offline mode stays offline even when provider credentials are configured.
  if (live && !isAiConfigured()) {
    throw new Error('Live evaluation requires both LLM_API_KEY and LLM_MODEL in the repository .env or process environment')
  }

  const cases = args.has('--smoke') ? evaluationCases.slice(0, 1) : evaluationCases
  const rows = []
  for (const testCase of cases) {
    const started = performance.now()
    const result: RecommendationResult = live
      ? await recommend(testCase.input, { signals: testCase.signals })
      : {
        version: testCase.input.version, mode: 'rules_fallback',
        fallback_reason: 'missing_api_key', empty_reason: null,
        recommendations: baselineCards(testCase.input, testCase.signals),
      }
    const score = scoreEvaluation(testCase, result)
    rows.push({
      ...score,
      elapsedMs: Math.round(performance.now() - started),
      payloadBytes: Buffer.byteLength(buildUserMessage(testCase.input), 'utf8'),
      fallbackReason: live ? result.fallback_reason : null,
    })
  }
  const scored = summarizeEvaluations(rows)
  const summary = live ? scored : {
    totalCases: scored.totalCases,
    baselineExpectedChoicePassRate: scored.baselineExpectedChoicePassRate,
    acceptedAiCases: 0,
    aiAcceptanceRate: null,
    aiExpectedChoicePassRate: null,
    aiBaselineAgreementRate: null,
    fallbackRate: null,
  }
  const report = {
    run: live ? 'live' : 'baseline_only',
    model: live ? getModel() : null,
    providerBudgetMs: getTimeoutMs(),
    dataset: 'authored synthetic regression cases; not official or hidden judge profiles',
    summary,
    cases: rows.map((row) => ({
      ...row, mode: live ? row.mode : 'baseline_only', fallback: live ? row.fallback : null,
    })),
  }
  if (args.has('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`${report.run}: ${cases.length} authored cases; ${live ? `model ${getModel()}` : 'no provider calls'}`)
    console.table(report.cases.map((row) => ({
      case: row.caseId, mode: row.mode, top: row.topCandidateId,
      baselinePass: row.baselineExpectedChoicePass,
      aiPass: row.aiExpectedChoicePass ?? 'not measured',
      citations: row.validCitations, version: row.validSnapshotVersion,
      ms: row.elapsedMs, bytes: row.payloadBytes,
      fallback: row.fallbackReason ?? '-',
    })))
    console.log(JSON.stringify(summary, null, 2))
    console.log('This measures authored regression expectations, not product impact or judge performance.')
  }
  if (rows.some((row) => !row.baselineExpectedChoicePass || !row.validCitations || !row.validSnapshotVersion)) process.exitCode = 1
  if (live && rows.some((row) => !row.acceptedAi || row.aiExpectedChoicePass !== true || row.elapsedMs > 10_000)) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  // Provider error text and source snapshots must not become terminal output.
  console.error(error instanceof Error ? error.message : 'Evaluation failed')
  process.exitCode = 1
})
