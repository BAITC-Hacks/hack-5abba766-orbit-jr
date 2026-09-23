import { describe, expect, it } from 'vitest'
import { rankCandidates, rulesCards } from '@/server/ai/rank'
import { candidate, gain, input } from './fixtures'

describe('rankCandidates', () => {
  it('prefers a smaller gain that closes a target gap over a bigger one that does not', () => {
    const onGap = candidate({ event_id: 'EV_GAP', expected_changes: [gain('SK_1', 2, 3)] })
    const offGap = candidate({
      event_id: 'EV_OFF',
      expected_changes: [gain('SK_9', 1, 4, false)],
    })
    expect(rankCandidates([offGap, onGap])[0]?.event_id).toBe('EV_GAP')
  })

  it('weights critical skills above ordinary gap skills', () => {
    const critical = candidate({
      event_id: 'EV_CRIT',
      expected_changes: [gain('SK_1', 2, 3, true, true)],
    })
    const ordinary = candidate({ event_id: 'EV_ORD', expected_changes: [gain('SK_2', 2, 3)] })
    expect(rankCandidates([ordinary, critical])[0]?.event_id).toBe('EV_CRIT')
  })

  it('prefers finishing something already started over an equivalent new start', () => {
    const started = candidate({
      event_id: 'EV_A',
      action: 'continue',
      expected_changes: [gain('SK_1', 2, 3)],
    })
    const fresh = candidate({ event_id: 'EV_B', expected_changes: [gain('SK_1', 2, 3)] })
    expect(rankCandidates([fresh, started])[0]?.event_id).toBe('EV_A')
  })

  it('penalises a longer activity when the gain is identical', () => {
    const short = candidate({ event_id: 'EV_S', duration_hours: 4, expected_changes: [gain('SK_1', 2, 3)] })
    const long = candidate({ event_id: 'EV_L', duration_hours: 40, expected_changes: [gain('SK_1', 2, 3)] })
    expect(rankCandidates([long, short])[0]?.event_id).toBe('EV_S')
  })

  it('ignores a change that would not raise the level', () => {
    const useful = candidate({ event_id: 'EV_U', expected_changes: [gain('SK_1', 2, 3)] })
    const capped = candidate({ event_id: 'EV_C', expected_changes: [gain('SK_1', 4, 4)] })
    expect(rankCandidates([capped, useful])[0]?.event_id).toBe('EV_U')
  })

  it('is deterministic when scores tie', () => {
    const a = candidate({ event_id: 'EV_B', expected_changes: [gain('SK_1', 2, 3)] })
    const b = candidate({ event_id: 'EV_A', expected_changes: [gain('SK_1', 2, 3)] })
    expect(rankCandidates([a, b]).map((c) => c.event_id)).toEqual(['EV_A', 'EV_B'])
    expect(rankCandidates([b, a]).map((c) => c.event_id)).toEqual(['EV_A', 'EV_B'])
  })
})

describe('rulesCards', () => {
  it('returns at most three cards with facts spanning several categories', () => {
    const many = ['EV_1', 'EV_2', 'EV_3', 'EV_4', 'EV_5'].map((id) =>
      candidate({ event_id: id, expected_changes: [gain('SK_1', 2, 3)] }),
    )
    const cards = rulesCards(input(many))
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(new Set(card.factors.map((f) => f.category)).size).toBeGreaterThanOrEqual(3)
    }
  })
})
