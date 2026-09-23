import { assertRecommendationEvidence } from '../domain/recommendation-evidence';
import { rankWithModel } from './adapter';
import { validateRanking as checkRanking, cardsFromRanking } from './response-validator';
import { pickReasonFactIds } from '../domain/baseline';
import type { AiRankingInput, AiRankingOutput, FallbackReason } from '../types';
export { cardsFromRanking };

export class AiError extends Error {
  constructor(public reason: FallbackReason) { super(reason); }
}
export function validateRanking(value: unknown, input: AiRankingInput): AiRankingOutput {
  const checked = checkRanking(value, input);
  if (!checked.ok) throw new AiError('invalid_response');
  return checked.output;
}
/** The domain already ranked with complete history/unlock signals; never sort again here. */
export function baselineRanking(input: AiRankingInput): AiRankingOutput {
  assertRecommendationEvidence(input.candidates);
  return { choices: input.candidates.slice(0, input.limit).map(candidate => ({
    candidate_id: candidate.candidate_id, reason_fact_ids: pickReasonFactIds(candidate),
  })) };
}
export async function rankCandidates(input: AiRankingInput, signal?: AbortSignal): Promise<AiRankingOutput> {
  assertRecommendationEvidence(input.candidates);
  const attempt = await rankWithModel(input, signal);
  if (!attempt.ok) throw new AiError(attempt.reason);
  return validateRanking(attempt.output, input);
}
