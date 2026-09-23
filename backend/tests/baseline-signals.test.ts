import { describe, expect, it } from 'vitest'
import type { ParticipationSource } from '../src/types'
import { buildBaselineSignals } from '../src/domain/baseline-signals'
import { rankBaseline } from '../src/domain/baseline'
import { candidate, change, input } from './team-ai/fixtures'

const row = (id: string, status: ParticipationSource['status'], date: string, extra: Partial<ParticipationSource> = {}): ParticipationSource => ({
  record_id: id, employee_id: 'judge-new', event_id: 'EV_A', date, status,
  due_date: null, completion_pct: status === 'completed' ? 100 : 0,
  score: null, feedback_rating: null, assigned_by: 'self', ...extra,
})

describe('baseline history signals', () => {
  it('uses only the latest three terminal observations for the requested employee and scenario date', () => {
    const signals = buildBaselineSignals([candidate({ candidate_id: 'C', event_id: 'EV_A' })], {
      employeeId: 'judge-new', asOfDate: '2026-10-01', unlockedWeightedGain: new Map(),
      history: [
        row('old', 'dropped', '2026-01-01'),
        row('r1', 'completed', '2026-05-01'),
        row('r2', 'declined', '2026-06-01'),
        row('r3', 'completed', '2026-07-01'),
        row('ongoing', 'in_progress', '2026-08-01'),
        row('late', 'overdue', '2026-09-01'),
        row('future', 'no_show', '2026-10-02'),
        row('someone-else', 'no_show', '2026-09-02', { employee_id: 'other' }),
      ],
    })
    expect(signals.negativeOutcomes.get('C')).toBe(1)
  })

  it('lets observed history change the choice between equally useful activities', () => {
    const a = candidate({ candidate_id: 'A', event_id: 'EV_A', expected_skill_changes: [change('SK_PLAIN', 2, 3)] })
    const b = candidate({ candidate_id: 'B', event_id: 'EV_B', expected_skill_changes: [change('SK_PLAIN', 2, 3)] })
    const state = input([a, b])
    const context = { employeeId: 'judge-new', asOfDate: '2026-10-01', unlockedWeightedGain: new Map<string, number>([['A', 0], ['B', 0]]) }
    expect(rankBaseline(state, buildBaselineSignals([a, b], { ...context, history: [] }))[0]?.candidate_id).toBe('A')
    const signals = buildBaselineSignals([a, b], { ...context, history: [row('missed', 'no_show', '2026-09-01')] })
    expect(rankBaseline(state, signals)[0]?.candidate_id).toBe('B')
  })

  it('maps event history to each attempt identity and preserves supplied unlock signals', () => {
    const candidates = [candidate({ candidate_id: 'P1', event_id: 'EV_A' }), candidate({ candidate_id: 'P2', event_id: 'EV_A' })]
    const unlocks = new Map([['P1', 4]])
    const signals = buildBaselineSignals(candidates, {
      employeeId: 'judge-new', asOfDate: '2026-10-01', unlockedWeightedGain: unlocks,
      history: [row('r1', 'dropped', '2026-09-01')],
    })
    expect(signals.negativeOutcomes).toEqual(new Map([['P1', 1], ['P2', 1]]))
    expect(signals.unlockedWeightedGain).toBe(unlocks)
  })
})


it('uses descending record ID as the latest-observation tie break', () => {
  const c = candidate({ candidate_id: 'C', event_id: 'EV_A' })
  const signals = buildBaselineSignals([c], {
    employeeId: 'judge-new', asOfDate: '2026-10-01', unlockedWeightedGain: new Map([['C', 0]]),
    history: [row('A', 'no_show', '2026-09-01'), row('B', 'completed', '2026-09-01'), row('C', 'completed', '2026-09-01'), row('D', 'completed', '2026-09-01')],
  })
  expect(signals.negativeOutcomes.get('C')).toBe(0)
})
