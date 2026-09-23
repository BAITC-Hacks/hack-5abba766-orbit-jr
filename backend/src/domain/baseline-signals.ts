import type { Candidate, DateOnly, Id, ParticipationSource } from '../types'
import type { BaselineSignals } from './baseline'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const TERMINAL_STATUSES = new Set(['completed', 'declined', 'dropped', 'no_show'])

/**
 * History is scoped explicitly: never infer an employee from a shared history file.
 * Only observed source records up to the scenario date affect this signal.
 * One-step unlocked gains are supplied by eligibility, which knows the actual catalog.
 */
export function buildBaselineSignals(
  candidates: readonly Candidate[],
  context: {
    employeeId: Id
    asOfDate: DateOnly
    history: readonly ParticipationSource[]
    unlockedWeightedGain: ReadonlyMap<Id, number>
  },
): BaselineSignals {
  const candidateEvents = new Set(candidates.map((candidate) => candidate.event_id))
  const relevant = context.history
    .filter((row) => row.employee_id === context.employeeId && row.date <= context.asOfDate
      && candidateEvents.has(row.event_id) && TERMINAL_STATUSES.has(row.status))
    .sort((a, b) => compare(b.date, a.date) || compare(b.record_id, a.record_id))
  const perEvent = new Map<Id, { seen: number; negative: number }>()
  for (const row of relevant) {
    const count = perEvent.get(row.event_id) ?? { seen: 0, negative: 0 }
    if (count.seen >= 3) continue
    count.seen += 1
    if (row.status !== 'completed') count.negative += 1
    perEvent.set(row.event_id, count)
  }
  return {
    unlockedWeightedGain: context.unlockedWeightedGain,
    negativeOutcomes: new Map(candidates.map((candidate) => [
      candidate.candidate_id, perEvent.get(candidate.event_id)?.negative ?? 0,
    ])),
  }
}
