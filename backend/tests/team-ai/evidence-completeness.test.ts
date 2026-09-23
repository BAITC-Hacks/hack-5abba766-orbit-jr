import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateProviderRanking } from '../../src/ai/response-validator'
import { candidate, fact, input } from './fixtures'

const rankWithModel = vi.hoisted(() => vi.fn())
vi.mock('../../src/ai/adapter', () => ({ rankWithModel }))
const { recommend } = await import('../../src/ai/recommend')

// IDs intentionally carry no category names or parseable event relationships.
const state = () => input([candidate({ candidate_id: 'opaque-choice', unlocks_event_ids: ['opaque-event'], facts: [
  fact('a', 'grade'), fact('b', 'skill_gap'), fact('c', 'target_requirement'),
  fact('d', 'target_requirement'), fact('e', 'history'), fact('f', 'effort'),
  fact('g', 'history'), fact('h', 'effort'),
] })])
const output = (ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) => ({ choices: [{
  candidate_id: 'opaque-choice', reason_fact_ids: ids, alternative_candidate_id: null,
}] })
afterEach(() => vi.resetAllMocks())

describe('provider evidence completeness', () => {
  it.each(['c', 'd', 'e', 'f', 'g', 'h'])('rejects omission of required opaque fact %s despite three legal categories', omitted => {
    const raw = output(output().choices[0].reason_fact_ids.filter(id => id !== omitted))
    expect(validateProviderRanking(raw, state())).toMatchObject({ ok: false })
  })

  it('accepts complete evidence without changing its order or inserting IDs', () => {
    const raw = output(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
    const before = structuredClone(raw)
    const result = validateProviderRanking(raw, state())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.cards[0].reason_fact_ids).toEqual(raw.choices[0].reason_fact_ids)
    expect(raw).toEqual(before)
  })

  it('does not require an absent history or effort fact or extra target facts without unlocks', () => {
    const snapshot = state()
    snapshot.candidates[0].unlocks_event_ids = []
    snapshot.candidates[0].facts = snapshot.candidates[0].facts.filter(f => !['history', 'effort'].includes(f.category))
    expect(validateProviderRanking(output(['a', 'b', 'c']), snapshot).ok).toBe(true)
  })

  it('turns incomplete but otherwise grounded provider evidence into explicit validated fallback', async () => {
    rankWithModel.mockResolvedValue({ ok: true, output: output(['a', 'b', 'c']), ms: 1 })
    const signals = { similarFormatPenalty: new Map([['opaque-choice', 0]]), unlockedWeightedGain: new Map([['opaque-choice', 1]]), negativeOutcomes: new Map([['opaque-choice', 0]]) }
    const result = await recommend(state(), { signals })
    expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' })
    expect(new Set(result.recommendations[0].reason_fact_ids)).toEqual(new Set(output().choices[0].reason_fact_ids))
  })
})
