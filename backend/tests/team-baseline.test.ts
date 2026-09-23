import { InvalidRecommendationEvidenceError } from '../src/domain/recommendation-evidence'
import { describe, expect, it } from 'vitest'
import { baselineCards as buildBaselineCards, rankBaseline as orderBaseline, weightedDirectGain, type BaselineSignals } from '../src/domain/baseline'
import { candidate, change, fact, input, skill } from './team-ai/fixtures'

// Fixtures supply explicit zero signals; production must supply computed signals.
function syntheticSignals(snapshot: ReturnType<typeof input>, supplied?: Partial<BaselineSignals>): BaselineSignals {
  return {
    similarFormatPenalty: new Map(snapshot.candidates.map(c => [c.candidate_id, supplied?.similarFormatPenalty?.get(c.candidate_id) ?? 0])),
    unlockedWeightedGain: new Map(snapshot.candidates.map(c => [c.candidate_id, supplied?.unlockedWeightedGain?.get(c.candidate_id) ?? 0])),
    negativeOutcomes: new Map(snapshot.candidates.map(c => [c.candidate_id, supplied?.negativeOutcomes?.get(c.candidate_id) ?? 0])),
  }
}
const rankBaseline = (snapshot: ReturnType<typeof input>, signals?: Partial<BaselineSignals>) => orderBaseline(snapshot, syntheticSignals(snapshot, signals))
const baselineCards = (snapshot: ReturnType<typeof input>) => buildBaselineCards(snapshot, syntheticSignals(snapshot))

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
    const signals: Partial<BaselineSignals> = {
      unlockedWeightedGain: new Map([['PREP', 4]]),
      negativeOutcomes: new Map(),
    }
    const snapshot = input([
      // direct 2 vs prerequisite 0 + 0.5*4 = 2 -> tie, broken by effort then event_id
      candidate({ candidate_id: 'DIRECT', expected_skill_changes: [change('SK_PLAIN', 2, 4)] }),
      candidate({ candidate_id: 'PREP', relevance: 'prerequisite', duration_hours: 20 }),
    ], { skills: [skill('SK_PLAIN', { required_level: 4, gap: 2 })] })
    expect(order(rankBaseline(snapshot, signals))[0]).toBe('DIRECT')
  })

  it('prefers fewer negative outcomes on the same event', () => {
    const signals: Partial<BaselineSignals> = {
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

  it('rejects incomplete evidence instead of presenting an unsupported fallback', () => {
    const odd = candidate({ candidate_id: 'X', facts: [fact('X-e', 'effort')] })
    expect(() => baselineCards(input([odd]))).toThrow(InvalidRecommendationEvidenceError)
  })

  it('rejects ambiguous duplicate fact IDs', () => {
    const ambiguous = candidate({ candidate_id: 'X', facts: [fact('same', 'grade'), fact('same', 'skill_gap'), fact('third', 'history')] })
    expect(() => baselineCards(input([ambiguous]))).toThrow('duplicate fact')
  })

  it('retains multiple verified facts in the same category', () => {
    const c = candidate({ candidate_id: 'X' })
    c.facts.push(fact('conditional-unlock', 'target_requirement'))
    expect(baselineCards(input([c]))[0].reason_fact_ids).toContain('conditional-unlock')
  })
})


describe('baseline integration invariants', () => {
  it('counts only target gap closure and caps gains at the target requirement', () => {
    const profile = [skill('SK_PLAIN'), skill('SK_OFF', { required_level: null, gap: null }), skill('SK_CRIT', { critical: true })]
    const excessive = candidate({ candidate_id: 'EXCESS', expected_skill_changes: [change('SK_PLAIN', 2, 5), change('SK_OFF', 0, 5), change('SK_CRIT', 3, 5)] })
    expect(weightedDirectGain(excessive, new Map(profile.map(s => [s.skill_id, s])))).toBe(1)
  })

  it('never silently substitutes missing domain history or unlock signals', () => {
    const snapshot = input([candidate({ candidate_id: 'C' })])
    expect(() => orderBaseline(snapshot, { unlockedWeightedGain: new Map(), negativeOutcomes: new Map(), similarFormatPenalty: new Map() })).toThrow('Missing or invalid baseline signal')
  })

  it('breaks ties between actions of one event by candidate ID', () => {
    const a = candidate({ candidate_id: 'action-A', event_id: 'same-event' })
    const b = candidate({ candidate_id: 'action-B', event_id: 'same-event' })
    expect(order(rankBaseline(input([b, a])))).toEqual(['action-A', 'action-B'])
  })
})

describe('goal relevance', () => {
  const skills = [
    skill('TARGET', { current_level: 0, baseline_level: 0, required_level: 5, gap: 5 }),
    skill('OFF', { current_level: 0, baseline_level: 0, required_level: null, gap: null }),
  ]

  it('does not let a large off-goal gain outrank greater target progress', () => {
    const noisy = candidate({ candidate_id: 'NOISY', expected_skill_changes: [change('TARGET', 0, 1), change('OFF', 0, 5)] })
    const useful = candidate({ candidate_id: 'USEFUL', expected_skill_changes: [change('TARGET', 0, 2)] })
    expect(order(rankBaseline(input([noisy, useful], { skills })))[0]).toBe('USEFUL')
  })

  it('caps usefulness at the remaining gap without changing the actual gain', () => {
    const s = skill('TARGET', { current_level: 2, required_level: 3, gap: 1 })
    const c = candidate({ candidate_id: 'C', expected_skill_changes: [change('TARGET', 2, 5)] })
    expect(weightedDirectGain(c, new Map([['TARGET', s]]))).toBe(1)
    expect(c.expected_skill_changes[0]?.gain).toBe(3)
  })

  it('does not reward growth above an already achieved requirement', () => {
    const s = skill('TARGET', { current_level: 3, required_level: 3, gap: 0 })
    const c = candidate({ candidate_id: 'C', expected_skill_changes: [change('TARGET', 3, 5)] })
    expect(weightedDirectGain(c, new Map([['TARGET', s]]))).toBe(0)
  })

  it('resolves equivalent attempts of the same event by stable candidate ID', () => {
    const a = candidate({ candidate_id: 'ATTEMPT_A', event_id: 'SAME' })
    const b = candidate({ candidate_id: 'ATTEMPT_B', event_id: 'SAME' })
    expect(order(rankBaseline(input([b, a])))).toEqual(['ATTEMPT_A', 'ATTEMPT_B'])
    expect(order(rankBaseline(input([a, b])))).toEqual(['ATTEMPT_A', 'ATTEMPT_B'])
  })

  it('prefers continuing an equally useful and equally costly activity', () => {
    const fresh = candidate({ candidate_id: 'A', action: 'start' })
    const ongoing = candidate({ candidate_id: 'Z', action: 'continue', participation_id: 'ATTEMPT' })
    expect(order(rankBaseline(input([fresh, ongoing])))[0]).toBe('Z')
  })
})
