import { describe, expect, it } from 'vitest'
import { baselineCards, rankBaseline, type BaselineSignals } from '../../src/server/domain/baseline'
import { candidate, change, fact, input, skill } from '../ai/fixtures'

const order = (result: { candidate_id: string }[]) => result.map((c) => c.candidate_id)

describe('rankBaseline', () => {
  it('puts a closed critical gap ahead of a larger ordinary gain', () => {
    const result = rankBaseline(
      input([
        candidate({ candidate_id: 'BIG', expected_skill_changes: [change('SK_PLAIN', 1, 4)] }),
        candidate({ candidate_id: 'CRIT', expected_skill_changes: [change('SK_CRIT', 2, 3)] }),
      ]),
    )
    expect(order(result)[0]).toBe('CRIT')
  })

  it('does not count a critical skill that stays below the required level', () => {
    const result = rankBaseline(
      input([
        candidate({ candidate_id: 'SHORT', expected_skill_changes: [change('SK_CRIT', 0, 1)] }),
        candidate({ candidate_id: 'FULL', expected_skill_changes: [change('SK_CRIT', 2, 3)] }),
      ]),
    )
    expect(order(result)[0]).toBe('FULL')
  })

  it('weights a critical skill twice an ordinary one when no gap is fully closed', () => {
    const skills = [skill('SK_CRIT', { critical: true, required_level: 5, gap: 3 }), skill('SK_PLAIN', { required_level: 5, gap: 3 })]
    const result = rankBaseline(
      input(
        [
          candidate({ candidate_id: 'PLAIN', expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
          candidate({ candidate_id: 'CRIT', expected_skill_changes: [change('SK_CRIT', 2, 3)] }),
        ],
        { skills },
      ),
    )
    expect(order(result)[0]).toBe('CRIT')
  })

  it('discounts unlocked gain by half rather than treating it as direct', () => {
    const signals: BaselineSignals = {
      unlockedWeightedGain: new Map([['PREP', 4]]),
      negativeOutcomes: new Map(),
    }
    const snapshot = input([
      // direct 2 vs prerequisite 0 + 0.5*4 = 2 -> tie, broken by effort then event_id
      candidate({ candidate_id: 'DIRECT', expected_skill_changes: [change('SK_PLAIN', 2, 4)] }),
      candidate({ candidate_id: 'PREP', relevance: 'prerequisite', duration_hours: 20 }),
    ])
    expect(order(rankBaseline(snapshot, signals))[0]).toBe('DIRECT')
  })

  it('prefers fewer negative outcomes on the same event', () => {
    const signals: BaselineSignals = {
      unlockedWeightedGain: new Map(),
      negativeOutcomes: new Map([['BAD', 2]]),
    }
    const snapshot = input([
      candidate({ candidate_id: 'BAD', expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
      candidate({ candidate_id: 'GOOD', expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
    ])
    expect(order(rankBaseline(snapshot, signals))[0]).toBe('GOOD')
  })

  it('prefers lower effort when everything else ties', () => {
    const result = rankBaseline(
      input([
        candidate({ candidate_id: 'LONG', duration_hours: 40, expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
        candidate({ candidate_id: 'SHORT', duration_hours: 4, expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
      ]),
    )
    expect(order(result)[0]).toBe('SHORT')
  })

  it('is deterministic - identical candidates resolve by event_id either way round', () => {
    const a = candidate({ candidate_id: 'A', event_id: 'EV_2' })
    const b = candidate({ candidate_id: 'B', event_id: 'EV_1' })
    expect(order(rankBaseline(input([a, b])))).toEqual(['B', 'A'])
    expect(order(rankBaseline(input([b, a])))).toEqual(['B', 'A'])
  })

  it('ignores a change that raises nothing', () => {
    const result = rankBaseline(
      input([
        candidate({ candidate_id: 'CAPPED', expected_skill_changes: [change('SK_PLAIN', 3, 3)] }),
        candidate({ candidate_id: 'REAL', expected_skill_changes: [change('SK_PLAIN', 2, 3)] }),
      ]),
    )
    expect(order(result)[0]).toBe('REAL')
  })
})

describe('baselineCards', () => {
  it('respects the limit and ranks from one', () => {
    const snapshot = input(
      ['A', 'B', 'C', 'D'].map((id) => candidate({ candidate_id: id })),
      { limit: 2 },
    )
    const cards = baselineCards(snapshot)
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.rank)).toEqual([1, 2])
  })

  it('cites facts covering the three categories the contract requires', () => {
    const cards = baselineCards(input([candidate({ candidate_id: 'A' })]))
    const cited = new Set(
      cards[0]!.reason_fact_ids.map((id) => id.replace('A-', '')),
    )
    expect(cited.has('gap')).toBe(true)
    expect(cited.has('req')).toBe(true)
    expect(cited.has('grade')).toBe(true)
  })

  it('never invents an alternative', () => {
    const cards = baselineCards(input([candidate({ candidate_id: 'A' }), candidate({ candidate_id: 'B' })]))
    expect(cards.every((c) => c.alternative === null && c.alternative_candidate_id === null)).toBe(true)
  })

  it('falls back to any facts when the preferred categories are missing', () => {
    const odd = candidate({ candidate_id: 'X', facts: [fact('X-e', 'effort')] })
    const cards = baselineCards(input([odd]))
    expect(cards[0]?.reason_fact_ids).toEqual(['X-e'])
  })
})
