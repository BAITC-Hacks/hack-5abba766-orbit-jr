import type { Candidate, DateOnly, Id, ParticipationSource } from '../types'
import type { BaselineSignals } from './baseline'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const TERMINAL_STATUSES = new Set(['completed', 'declined', 'dropped', 'no_show'])

/** Keep the evidence and ranking penalty on the same three observed outcomes. */
export function latestTerminalHistoryByEvent(
  eventIds: ReadonlySet<Id>,
  context: { employeeId: Id; asOfDate: DateOnly; history: readonly ParticipationSource[] },
): Map<Id, ParticipationSource[]> {
  const relevant = context.history
    .filter((row) => row.employee_id === context.employeeId && row.date <= context.asOfDate
      && eventIds.has(row.event_id) && TERMINAL_STATUSES.has(row.status))
    .sort((a, b) => compare(b.date, a.date) || compare(b.record_id, a.record_id))
  const perEvent = new Map<Id, ParticipationSource[]>()
  for (const row of relevant) {
    const recent = perEvent.get(row.event_id) ?? []
    if (recent.length >= 3) continue
    recent.push(row)
    perEvent.set(row.event_id, recent)
  }
  return perEvent
}

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
  const perEvent = latestTerminalHistoryByEvent(candidateEvents, context)
  return {
    unlockedWeightedGain: context.unlockedWeightedGain,
    negativeOutcomes: new Map(candidates.map((candidate) => [
      candidate.candidate_id, perEvent.get(candidate.event_id)?.filter((row) => row.status !== 'completed').length ?? 0,
    ])),
  }
}
