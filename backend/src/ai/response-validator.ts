import { REQUIRED_FACT_CATEGORIES, MIN_REQUIRED_FACT_CATEGORIES, assertRecommendationEvidence } from '../domain/recommendation-evidence'
import { z } from 'zod'
import type {
  AiRankingInput,
  AiRankingOutput,
  Candidate,
  RecommendationCard,
  RecommendationFact,
} from '../types'

/**
 * Semantic validation of the model's ranking.
 *
 * TypeScript does not check incoming JSON and a schema-valid answer can still be
 * a lie, so every id is resolved against the candidate snapshot the server
 * built. Cards carry the server's own numbers; nothing the model wrote is
 * rendered as a fact.
 */

export const AiRankingOutputSchema = z.object({
  choices: z
    .array(
      z.object({
        candidate_id: z.string().min(1),
        reason_fact_ids: z.array(z.string().min(1)).min(1),
        alternative_candidate_id: z.string().min(1).nullish(),
      }).strict(),
    )
    .min(1).max(3),
}).strict()


export type ValidationResult =
  | { ok: true; cards: RecommendationCard[]; output: AiRankingOutput }
  | { ok: false; detail: string }

function alternativeOf(candidate: Candidate): NonNullable<RecommendationCard['alternative']> {
  return {
    candidate_id: candidate.candidate_id,
    event_id: candidate.event_id,
    title: candidate.title,
    facts: candidate.facts,
  }
}

export function validateRanking(raw: unknown, input: AiRankingInput): ValidationResult {
  try { assertRecommendationEvidence(input.candidates) }
  catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Invalid candidate evidence' } }
  const parsed = AiRankingOutputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, detail: `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` }
  }

  const { choices } = parsed.data
  const maxChoices = Math.min(input.limit, input.candidates.length)
  if (choices.length > maxChoices) {
    return { ok: false, detail: `${choices.length} choices, at most ${maxChoices} allowed` }
  }

  const byId = new Map(input.candidates.map((c) => [c.candidate_id, c]))
  const chosen = new Set(choices.map((c) => c.candidate_id))
  if (chosen.size !== choices.length) {
    return { ok: false, detail: 'duplicate candidate_id' }
  }

  const cards: RecommendationCard[] = []

  for (const [index, choice] of choices.entries()) {
    const candidate = byId.get(choice.candidate_id)
    if (!candidate) {
      return { ok: false, detail: `unknown candidate_id ${choice.candidate_id}` }
    }

    const factById = new Map<string, RecommendationFact>(
      candidate.facts.map((f) => [f.fact_id, f]),
    )
    const factIds: string[] = []
    const categories = new Set<string>()
    for (const factId of choice.reason_fact_ids) {
      const fact = factById.get(factId)
      if (!fact) {
        return { ok: false, detail: `fact ${factId} does not belong to ${choice.candidate_id}` }
      }
      if (factIds.includes(factId)) return { ok: false, detail: 'duplicate reason_fact_id' }
      factIds.push(factId)
      if (REQUIRED_FACT_CATEGORIES.has(fact.category)) categories.add(fact.category)
    }

    if (categories.size < MIN_REQUIRED_FACT_CATEGORIES) {
      return {
        ok: false,
        detail: `${choice.candidate_id} covers ${categories.size} required fact categories, needs ${MIN_REQUIRED_FACT_CATEGORIES}`,
      }
    }

    const altId = choice.alternative_candidate_id ?? null
    let alternative: RecommendationCard['alternative'] = null
    if (altId !== null) {
      const alt = byId.get(altId)
      if (!alt) return { ok: false, detail: `unknown alternative ${altId}` }
      if (chosen.has(altId)) {
        return { ok: false, detail: `alternative ${altId} is itself a recommendation` }
      }
      alternative = alternativeOf(alt)
    }

    cards.push({
      ...candidate,
      rank: index + 1,
      reason_fact_ids: factIds,
      alternative_candidate_id: altId,
      alternative,
    })
  }

  const output: AiRankingOutput = { choices: cards.map(card => ({ candidate_id: card.candidate_id, reason_fact_ids: card.reason_fact_ids, ...(card.alternative_candidate_id ? { alternative_candidate_id: card.alternative_candidate_id } : {}) })) }
  return { ok: true, cards, output }
}

/** Build only from validated server IDs, including the deterministic ordered fallback. */
export function cardsFromRanking(output: AiRankingOutput, candidates: Candidate[]): RecommendationCard[] {
  assertRecommendationEvidence(candidates)
  const byId = new Map(candidates.map(candidate => [candidate.candidate_id, candidate]))
  return output.choices.map((choice, index) => {
    const candidate = byId.get(choice.candidate_id)
    if (!candidate) throw new Error('Unknown validated candidate')
    const alt = choice.alternative_candidate_id ? byId.get(choice.alternative_candidate_id) : null
    if (choice.alternative_candidate_id && !alt) throw new Error('Unknown validated alternative')
    return { ...candidate, rank: index + 1, reason_fact_ids: choice.reason_fact_ids,
      alternative_candidate_id: alt?.candidate_id ?? null, alternative: alt ? alternativeOf(alt) : null }
  })
}
