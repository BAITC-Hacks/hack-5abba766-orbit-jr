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
  validCitations: boolean
  validSnapshotVersion: boolean
}

/** Measures authored acceptance choices only, not user benefit or hackathon scores. */
export function scoreEvaluation(testCase: EvaluationCase, result: RecommendationResult): EvaluationScore {
  const topCandidateId = result.recommendations[0]?.candidate_id ?? null
  const baselineTopCandidateId = rankBaseline(testCase.input, testCase.signals)[0]?.candidate_id ?? null
  const validCitations = validateRanking({
    choices: result.recommendations.map((card) => ({
      candidate_id: card.candidate_id,
      reason_fact_ids: card.reason_fact_ids,
      alternative_candidate_id: card.alternative_candidate_id,
    })),
  }, testCase.input).ok
  const validSnapshotVersion = result.version.dataset_revision === testCase.input.version.dataset_revision &&
    result.version.employee_revision === testCase.input.version.employee_revision
  const acceptedAi = result.mode === 'ai' && validCitations && validSnapshotVersion

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
    validCitations,
    validSnapshotVersion,
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
}

export function summarizeEvaluations(scores: readonly EvaluationScore[]): EvaluationSummary {
  const accepted = scores.filter((score) => score.acceptedAi)
  const fallbackCases = scores.filter((score) => score.fallback).length
  const rate = (count: number, denominator: number): number | null => denominator ? count / denominator : null
  return {
    totalCases: scores.length,
    acceptedAiCases: accepted.length,
    invalidAiCases: scores.filter((score) => score.mode === 'ai' && !score.acceptedAi).length,
    fallbackCases,
    noCandidatesCases: scores.filter((score) => score.mode === 'no_candidates').length,
    aiAcceptanceRate: rate(accepted.length, scores.length),
    fallbackRate: rate(fallbackCases, scores.length),
    aiExpectedChoicePassRate: rate(accepted.filter((score) => score.aiExpectedChoicePass).length, accepted.length),
    aiBaselineAgreementRate: rate(accepted.filter((score) => score.aiBaselineAgreement).length, accepted.length),
    baselineExpectedChoicePassRate: rate(scores.filter((score) => score.baselineExpectedChoicePass).length, scores.length),
  }
}
