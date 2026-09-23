import { describe, expect, it } from 'vitest'
import { validateRanking } from '@/server/ai/validate'
import { candidate, input } from './fixtures'

const base = input([candidate({ event_id: 'EV_1' }), candidate({ event_id: 'EV_2' })])

const good = {
  ranked: [
    {
      event_id: 'EV_1',
      fact_ids: ['EV_1-f1', 'EV_1-f2', 'EV_1-f3'],
      compared_to_event_id: 'EV_2',
      note: 'closest to the target',
    },
  ],
}

describe('validateRanking', () => {
  it('accepts a well-formed answer', () => {
    const outcome = validateRanking(good, base)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.cards).toHaveLength(1)
    expect(outcome.cards[0]?.factors.map((f) => f.id)).toEqual(['EV_1-f1', 'EV_1-f2', 'EV_1-f3'])
  })

  it('renders card numbers from server data, not from the model', () => {
    const outcome = validateRanking(good, base)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // duration comes from the candidate the server built
    expect(outcome.cards[0]?.duration_hours).toBe(8)
    expect(outcome.cards[0]?.title).toBe('Event EV_1')
  })

  it('rejects an event id that is not a candidate', () => {
    const outcome = validateRanking({ ranked: [{ ...good.ranked[0], event_id: 'EV_404' }] }, base)
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.rejection).toContain('unknown event_id')
  })

  it('rejects a duplicate recommendation', () => {
    const outcome = validateRanking({ ranked: [good.ranked[0], good.ranked[0]] }, base)
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.rejection).toContain('duplicate')
  })

  it('rejects a fact id that does not belong to that candidate', () => {
    const outcome = validateRanking(
      { ranked: [{ ...good.ranked[0], fact_ids: ['EV_2-f1', 'EV_1-f2', 'EV_1-f3'] }] },
      base,
    )
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.rejection).toContain('unknown fact')
  })

  it('rejects a card justified by fewer than three fact categories', () => {
    const outcome = validateRanking(
      { ranked: [{ ...good.ranked[0], fact_ids: ['EV_1-f1', 'EV_1-f2'] }] },
      base,
    )
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.rejection).toContain('fact categories')
  })

  it('rejects a self-comparison', () => {
    const outcome = validateRanking(
      { ranked: [{ ...good.ranked[0], compared_to_event_id: 'EV_1' }] },
      base,
    )
    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.rejection).toContain('compared to itself')
  })

  it('rejects more than three recommendations', () => {
    const one = good.ranked[0]!
    const outcome = validateRanking({ ranked: [one, one, one, one] }, base)
    expect(outcome).toMatchObject({ ok: false })
  })

  it('flattens and caps model free text', () => {
    const outcome = validateRanking(
      { ranked: [{ ...good.ranked[0], note: '  line one\n\nline two  ' }] },
      base,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.cards[0]?.note).toBe('line one line two')
  })
})
