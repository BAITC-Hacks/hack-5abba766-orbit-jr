import { ModelRanking, type Candidate, type RecommendationCard, type RecommendationInput } from '@/contracts/ai'

/**
 * Turns raw model output into cards, or rejects it.
 *
 * Schema-valid JSON is not the same as a true answer. Every id the model
 * returns is checked against the candidate set the server built, and every
 * number on the resulting card comes from that candidate - never from the
 * model's text.
 */

export type ValidationOutcome =
  | { ok: true; cards: RecommendationCard[] }
  | { ok: false; rejection: string }

/** The architecture requires a card to stand on at least three kinds of reason. */
const MIN_FACT_CATEGORIES = 3

/** Model text may be shown as a subtitle, but never as a fact. */
function sanitizeNote(note: string | null): string | null {
  if (note === null) return null
  const flat = note.replace(/\s+/g, ' ').trim()
  return flat.length === 0 ? null : flat.slice(0, 200)
}

export function validateRanking(raw: unknown, input: RecommendationInput): ValidationOutcome {
  const parsed = ModelRanking.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, rejection: `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` }
  }

  const byId = new Map<string, Candidate>(input.candidates.map((c) => [c.event_id, c]))
  const seen = new Set<string>()
  const cards: RecommendationCard[] = []

  for (const item of parsed.data.ranked) {
    const candidate = byId.get(item.event_id)
    if (!candidate) return { ok: false, rejection: `unknown event_id ${item.event_id}` }
    if (seen.has(item.event_id)) return { ok: false, rejection: `duplicate event_id ${item.event_id}` }
    seen.add(item.event_id)

    const factById = new Map(candidate.facts.map((f) => [f.id, f]))
    const factors: Candidate['facts'] = []
    for (const factId of item.fact_ids) {
      const fact = factById.get(factId)
      if (!fact) return { ok: false, rejection: `unknown fact ${factId} on ${item.event_id}` }
      if (factors.some((f) => f.id === factId)) continue
      factors.push(fact)
    }

    const categories = new Set(factors.map((f) => f.category))
    if (categories.size < MIN_FACT_CATEGORIES) {
      return {
        ok: false,
        rejection: `${item.event_id} cites ${categories.size} fact categories, need ${MIN_FACT_CATEGORIES}`,
      }
    }

    if (item.compared_to_event_id !== null) {
      if (!byId.has(item.compared_to_event_id)) {
        return { ok: false, rejection: `unknown comparison ${item.compared_to_event_id}` }
      }
      if (item.compared_to_event_id === item.event_id) {
        return { ok: false, rejection: `${item.event_id} compared to itself` }
      }
    }

    cards.push({
      event_id: candidate.event_id,
      title: candidate.title,
      action: candidate.action,
      duration_hours: candidate.duration_hours,
      factors,
      expected_changes: candidate.expected_changes,
      compared_to_event_id: item.compared_to_event_id,
      note: sanitizeNote(item.note),
    })
  }

  return { ok: true, cards }
}
