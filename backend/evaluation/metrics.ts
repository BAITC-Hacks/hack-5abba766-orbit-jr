import { isDeepStrictEqual } from 'node:util'
import type { RecommendationResult } from '../../contracts/backend'
import { validateRanking } from '../src/ai/response-validator'
import { rankBaseline } from '../src/domain/baseline'
import type { EvaluationCase } from './cases'

export type EvaluationScore = {
  caseId: string
  mode: RecommendationResult['mode']
  topCandidateId: string | null
  baselineTopCandidateId: string | null
  baselineExpectedChoicePass: boolean
  acceptedAi: boolean
  /** Null means there was no accepted AI ranking to assess. */
  aiExpectedChoicePass: boolean | null
  /** Fallback copying the baseline must never count as AI agreement. */
  aiBaselineAgreement: boolean | null
  fallback: boolean
  fallbackReason: RecommendationResult['fallback_reason']
  validCitations: boolean
  validSnapshotVersion: boolean
  /** Ranking metadata and complete cards must match their server-grounded representation. */
  validResultContract: boolean
  /** Null means the case does not specify decisive evidence. Applies to any mode. */
  requiredTopEvidencePass: boolean | null
  /** Null means the case specifies top-choice quality only. Applies to any mode. */
  expectedCandidateOrderPass: boolean | null
}

/** Measures authored acceptance choices only, not user benefit or hackathon scores. */
export function scoreEvaluation(testCase: EvaluationCase, result: RecommendationResult): EvaluationScore {
  const topCandidateId = result.recommendations[0]?.candidate_id ?? null
  const baselineTopCandidateId = rankBaseline(testCase.input, testCase.signals)[0]?.candidate_id ?? null
  const validated = validateRanking({
    choices: result.recommendations.map((card) => ({
      candidate_id: card.candidate_id,
      reason_fact_ids: card.reason_fact_ids,
      alternative_candidate_id: card.alternative_candidate_id,
    })),
  }, testCase.input)
  const validCitations = validated.ok
  const validSnapshotVersion = result.version.dataset_revision === testCase.input.version.dataset_revision &&
    result.version.employee_revision === testCase.input.version.employee_revision
  // Revalidating only the model's IDs would silently discard corrupted ranks,
  // effects, participation identities or rendered alternatives in the actual result.
  const validResultContract = validated.ok && isDeepStrictEqual(result.recommendations, validated.cards) &&
    result.empty_reason === null && (
      (result.mode === 'ai' && result.fallback_reason === null) ||
      (result.mode === 'rules_fallback' && ['missing_api_key', 'provider_timeout', 'provider_error', 'invalid_response']
        .includes(result.fallback_reason))
    )
  const acceptedAi = result.mode === 'ai' && validCitations && validSnapshotVersion && validResultContract

  return {
    caseId: testCase.id,
    mode: result.mode,
    topCandidateId,
    baselineTopCandidateId,
    baselineExpectedChoicePass: baselineTopCandidateId !== null && testCase.expectedTopCandidateIds.includes(baselineTopCandidateId),
    acceptedAi,
    aiExpectedChoicePass: acceptedAi ? topCandidateId !== null && testCase.expectedTopCandidateIds.includes(topCandidateId) : null,
    aiBaselineAgreement: acceptedAi ? topCandidateId === baselineTopCandidateId : null,
    fallback: result.mode === 'rules_fallback',
    fallbackReason: result.fallback_reason,
    validCitations,
    validSnapshotVersion,
    validResultContract,
    requiredTopEvidencePass: testCase.requiredTopFactIds?.length
      ? testCase.requiredTopFactIds.every((id) => result.recommendations[0]?.reason_fact_ids.includes(id))
      : null,
    expectedCandidateOrderPass: testCase.expectedCandidateOrder
      ? result.recommendations.length > 0 && result.recommendations.every((card, index) =>
        card.candidate_id === testCase.expectedCandidateOrder![index])
      : null,
  }
}

export type EvaluationSummary = {
  totalCases: number
  acceptedAiCases: number
  invalidAiCases: number
  fallbackCases: number
  noCandidatesCases: number
  aiAcceptanceRate: number | null
  fallbackRate: number | null
  /** Denominator is accepted AI cases; null means no accepted AI was measured. */
  aiExpectedChoicePassRate: number | null
  /** Denominator is accepted AI cases, never fallback cases. */
  aiBaselineAgreementRate: number | null
  /** The deterministic baseline is run independently for every scenario. */
  baselineExpectedChoicePassRate: number | null
  /** Includes provider/validation failures in the denominator. */
  aiEndToEndPassRate: number | null
  /** Only accepted AI cases with explicit decisive-evidence expectations. */
  aiDecisiveEvidencePassRate: number | null
  /** Only accepted AI cases with an explicit order expectation, assessed over the returned prefix. */
  aiCandidateOrderPassRate: number | null
}

export function summarizeEvaluations(scores: readonly EvaluationScore[]): EvaluationSummary {
  const accepted = scores.filter((score) => score.acceptedAi)
  const fallbackCases = scores.filter((score) => score.fallback).length
  const evidenceCases = accepted.filter((score) => score.requiredTopEvidencePass !== null)
  const orderCases = accepted.filter((score) => score.expectedCandidateOrderPass !== null)
  const rate = (count: number, denominator: number): number | null => denominator ? count / denominator : null
  return {
    totalCases: scores.length,
    acceptedAiCases: accepted.length,
    invalidAiCases: scores.filter((score) => (score.mode === 'ai' && !score.acceptedAi)
      || score.fallbackReason === 'invalid_response').length,
    fallbackCases,
    noCandidatesCases: scores.filter((score) => score.mode === 'no_candidates').length,
    aiAcceptanceRate: rate(accepted.length, scores.length),
    fallbackRate: rate(fallbackCases, scores.length),
    aiExpectedChoicePassRate: rate(accepted.filter((score) => score.aiExpectedChoicePass).length, accepted.length),
    aiBaselineAgreementRate: rate(accepted.filter((score) => score.aiBaselineAgreement).length, accepted.length),
    baselineExpectedChoicePassRate: rate(scores.filter((score) => score.baselineExpectedChoicePass).length, scores.length),
    aiEndToEndPassRate: rate(accepted.filter((score) => score.aiExpectedChoicePass
      && score.requiredTopEvidencePass !== false && score.expectedCandidateOrderPass !== false).length, scores.length),
    aiDecisiveEvidencePassRate: rate(evidenceCases.filter((score) => score.requiredTopEvidencePass).length, evidenceCases.length),
    aiCandidateOrderPassRate: rate(orderCases.filter((score) => score.expectedCandidateOrderPass).length, orderCases.length),
  }
}
