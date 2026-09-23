import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaselineSignals } from '../../src/domain/baseline'
import { candidate, change, input, skill } from './fixtures'

const rankWithModel = vi.hoisted(() => vi.fn())
vi.mock('../../src/ai/adapter', () => ({ rankWithModel }))
const { recommend } = await import('../../src/ai/recommend')
afterEach(() => vi.resetAllMocks())

function scenario() {
  const state = input(['A', 'B', 'C', 'D'].map(candidate_id => candidate({ candidate_id })), {
    skills: [skill('critical', { critical: true, current_level: 0, baseline_level: 0, required_level: 1, gap: 1 }),
      skill('ordinary', { current_level: 0, baseline_level: 0, required_level: 5, gap: 5 })],
  })
  const signals: BaselineSignals = {
    unlockedWeightedGain: new Map(state.candidates.map(c => [c.candidate_id, 0])),
    negativeOutcomes: new Map(state.candidates.map(c => [c.candidate_id, 0])),
    similarFormatPenalty: new Map(state.candidates.map(c => [c.candidate_id, 0])),
  }
  const set = (field: keyof BaselineSignals, id: string, value: number) => (signals[field] as Map<string, number>).set(id, value)
  const respond = (ids: string[]) => {
    const output = { choices: ids.map(id => ({ candidate_id: id,
      reason_fact_ids: state.candidates.find(c => c.candidate_id === id)!.facts.map(f => f.fact_id).reverse(), alternative_candidate_id: null })) }
    rankWithModel.mockResolvedValue({ ok: true, ms: 1, output })
    return output
  }
  return { state, signals, set, respond }
}

describe('hard recommendation policy priorities', () => {
  it.each(['critical closures', 'total weighted target value', 'same-event outcomes', 'similar-format outcomes', 'duration', 'continuation'])(
    'rejects an omitted better candidate on %s despite complete valid evidence', async dimension => {
      const { state, signals, set, respond } = scenario()
      const [better, worse] = state.candidates
      if (dimension === 'critical closures') {
        better.expected_skill_changes = [change('critical', 0, 1)]
        worse.expected_skill_changes = [change('ordinary', 0, 5)]
        set('negativeOutcomes', 'A', 3)
      } else if (dimension === 'total weighted target value') {
        better.expected_skill_changes = [change('ordinary', 0, 1)]
        better.unlocks_event_ids = ['future']
        set('unlockedWeightedGain', 'A', 3)
        worse.expected_skill_changes = [change('ordinary', 0, 2)]
        set('negativeOutcomes', 'A', 3)
      } else if (dimension === 'same-event outcomes') {
        set('negativeOutcomes', 'B', 1)
        set('similarFormatPenalty', 'A', 1)
      } else if (dimension === 'similar-format outcomes') {
        set('similarFormatPenalty', 'B', 0.5)
        better.duration_hours = 20
        worse.duration_hours = 1
      } else if (dimension === 'duration') {
        better.duration_hours = 1
        worse.duration_hours = 20
        worse.action = 'continue'
        worse.participation_id = 'existing-B'
      } else {
        better.action = 'continue'
        better.participation_id = 'existing-A'
      }
      // Only these two candidates matter; the wrong winner is otherwise eligible.
      state.candidates = [better, worse]
      const raw = respond(['B'])
      const untouched = structuredClone(raw)
      const result = await recommend(state, { signals })
      expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' })
      expect(result.recommendations[0].candidate_id).toBe('A')
      expect(raw).toEqual(untouched)
    },
  )

  it('rejects the whole answer when a later card skips a better remaining candidate', async () => {
    const { state, signals, respond } = scenario()
    state.candidates.forEach((c, index) => { c.expected_skill_changes = [change('ordinary', 0, 4 - index)] })
    const raw = respond(['A', 'C', 'B'])
    const result = await recommend(state, { signals })
    expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' })
    expect(result.recommendations.map(c => c.candidate_id)).toEqual(['A', 'B', 'C'])
    expect(raw.choices.map(c => c.candidate_id)).toEqual(['A', 'C', 'B'])
  })

  it.each([1, 2, 3] as const)('accepts a valid %i-card prefix without comparing against already chosen candidates', async count => {
    const { state, signals, respond } = scenario()
    state.candidates.forEach((c, index) => { c.expected_skill_changes = [change('ordinary', 0, 4 - index)] })
    const chosen = ['A', 'B', 'C'].slice(0, count)
    const raw = respond(chosen)
    const result = await recommend(state, { signals })
    expect(result.mode).toBe('ai')
    expect(result.recommendations.map(c => c.candidate_id)).toEqual(chosen)
    expect(result.recommendations.map(c => c.reason_fact_ids)).toEqual(raw.choices.map(c => c.reason_fact_ids))
  })

  it('preserves exact ties across all six policy dimensions instead of enforcing stable ID order', async () => {
    const { state, signals, respond } = scenario()
    const raw = respond(['D', 'C', 'B'])
    const result = await recommend(state, { signals })
    expect(result.mode).toBe('ai')
    expect(result.recommendations.map(c => c.candidate_id)).toEqual(['D', 'C', 'B'])
    expect(result.recommendations.map(c => c.reason_fact_ids)).toEqual(raw.choices.map(c => c.reason_fact_ids))
  })
})
