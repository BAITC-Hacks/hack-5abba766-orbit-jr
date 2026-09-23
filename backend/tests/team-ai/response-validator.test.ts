import { describe, expect, it } from 'vitest'
import { validateRanking } from '../../src/ai/response-validator'
import { candidate, fact, input } from './fixtures'

const base = input([
  candidate({ candidate_id: 'C1' }),
  candidate({ candidate_id: 'C2' }),
  candidate({ candidate_id: 'C3' }),
])

const choice = (overrides: Record<string, unknown> = {}) => ({
  candidate_id: 'C1',
  reason_fact_ids: ['C1-gap', 'C1-req', 'C1-grade'],
  alternative_candidate_id: null,
  ...overrides,
})

describe('validateRanking', () => {
  it('accepts a well-formed ranking and numbers the ranks', () => {
    const result = validateRanking(
      { choices: [choice(), choice({ candidate_id: 'C2', reason_fact_ids: ['C2-gap', 'C2-req', 'C2-grade'] })] },
      base,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cards.map((c) => [c.candidate_id, c.rank])).toEqual([
      ['C1', 1],
      ['C2', 2],
    ])
  })

  it('builds the card from the server candidate, not from the model', () => {
    const result = validateRanking({ choices: [choice()] }, base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cards[0]).toMatchObject({
      event_id: 'EV_C1',
      title: 'Activity C1',
      duration_hours: 8,
      goal_coverage_delta: 0.1,
    })
  })

  it('rejects a candidate_id outside the snapshot', () => {
    const result = validateRanking({ choices: [choice({ candidate_id: 'C_404' })] }, base)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('unknown candidate_id')
  })

  it('rejects a duplicate choice', () => {
    const result = validateRanking({ choices: [choice(), choice()] }, base)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('duplicate')
  })

  it('rejects a fact borrowed from another candidate', () => {
    const result = validateRanking(
      { choices: [choice({ reason_fact_ids: ['C2-gap', 'C1-req', 'C1-grade'] })] },
      base,
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('does not belong')
  })

  it('rejects fewer than three of the required fact categories', () => {
    const result = validateRanking(
      { choices: [choice({ reason_fact_ids: ['C1-gap', 'C1-req'] })] },
      base,
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('required fact categories')
  })

  it('does not let eligibility or effort facts count toward the three', () => {
    const only = input([
      candidate({
        candidate_id: 'C1',
        facts: [fact('C1-gap', 'skill_gap'), fact('C1-eff', 'effort'), fact('C1-elig', 'eligibility')],
      }),
    ])
    const result = validateRanking(
      { choices: [choice({ reason_fact_ids: ['C1-gap', 'C1-eff', 'C1-elig'] })] },
      only,
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects more choices than the requested limit', () => {
    const limited = input([candidate({ candidate_id: 'C1' }), candidate({ candidate_id: 'C2' })], {
      limit: 1,
    })
    const result = validateRanking(
      { choices: [choice(), choice({ candidate_id: 'C2', reason_fact_ids: ['C2-gap', 'C2-req', 'C2-grade'] })] },
      limited,
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('at most 1')
  })

  it('accepts an alternative that was not itself recommended', () => {
    const result = validateRanking({ choices: [choice({ alternative_candidate_id: 'C3' })] }, base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cards[0]?.alternative).toMatchObject({ candidate_id: 'C3', event_id: 'EV_C3' })
  })

  it('rejects an alternative that is also a recommendation', () => {
    const result = validateRanking(
      {
        choices: [
          choice({ alternative_candidate_id: 'C2' }),
          choice({ candidate_id: 'C2', reason_fact_ids: ['C2-gap', 'C2-req', 'C2-grade'] }),
        ],
      },
      base,
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.detail).toContain('is itself a recommendation')
  })

  it('rejects an unknown alternative', () => {
    const result = validateRanking({ choices: [choice({ alternative_candidate_id: 'C_404' })] }, base)
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects an empty choice list', () => {
    expect(validateRanking({ choices: [] }, base)).toMatchObject({ ok: false })
  })
})


describe('strict model boundary', () => {
  it('rejects duplicate reason fact IDs instead of silently repairing model output', () => {
    expect(validateRanking({ choices: [choice({ reason_fact_ids: ['C1-gap', 'C1-req', 'C1-grade', 'C1-gap'] })] }, base)).toMatchObject({ ok: false })
  })
  it('rejects model prose and undeclared top-level fields', () => {
    expect(validateRanking({ choices: [choice({ explanation: 'invented claim' })] }, base)).toMatchObject({ ok: false })
    expect(validateRanking({ choices: [choice()], confidence: 1 }, base)).toMatchObject({ ok: false })
  })
})
