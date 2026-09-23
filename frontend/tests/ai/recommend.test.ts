import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_SIGNALS } from '../../src/server/domain/baseline'
import { candidate, fact, input } from './fixtures'

const rankWithModel = vi.hoisted(() => vi.fn())
vi.mock('../../src/server/ai/adapter', () => ({ rankWithModel }))
const { recommend } = await import('../../src/server/ai/recommend')
const snapshot = () => input([candidate({ candidate_id: 'NEW_JUDGE_ID' }), candidate({ candidate_id: 'OTHER' })])
const options = { signals: NO_SIGNALS }

afterEach(() => vi.resetAllMocks())

describe('recommendation boundary', () => {
  it('returns validated model choices with the exact snapshot version', async () => {
    rankWithModel.mockResolvedValue({ ok: true, ms: 20, output: { choices: [{
      candidate_id: 'OTHER', reason_fact_ids: ['OTHER-gap', 'OTHER-req', 'OTHER-grade'],
      alternative_candidate_id: 'NEW_JUDGE_ID',
    }] } })
    const state = snapshot()
    const result = await recommend(state, options)
    expect(result.mode).toBe('ai')
    expect(result.version).toEqual(state.version)
    expect(result.recommendations[0]?.candidate_id).toBe('OTHER')
    expect(result.recommendations[0]?.alternative?.candidate_id).toBe('NEW_JUDGE_ID')
  })

  it.each(['missing_api_key', 'provider_timeout', 'provider_error'] as const)(
    'returns validated rules with explicit %s', async (reason) => {
      rankWithModel.mockResolvedValue({ ok: false, reason, detail: 'test', ms: null })
      const result = await recommend(snapshot(), options)
      expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: reason, empty_reason: null })
      expect(result.recommendations).toHaveLength(2)
      expect(result.recommendations.every((card) => card.reason_fact_ids.length >= 3)).toBe(true)
    },
  )

  it('falls back if an otherwise valid model response invents a candidate', async () => {
    rankWithModel.mockResolvedValue({ ok: true, ms: 20, output: { choices: [{
      candidate_id: 'INVENTED', reason_fact_ids: ['OTHER-gap', 'OTHER-req', 'OTHER-grade'],
    }] } })
    const result = await recommend(snapshot(), options)
    expect(result).toMatchObject({ mode: 'rules_fallback', fallback_reason: 'invalid_response' })
    expect(result.recommendations.map((c) => c.candidate_id)).not.toContain('INVENTED')
  })

  it('does not call a model for a domain-confirmed empty state', async () => {
    const result = await recommend(input([]), { ...options, emptyReason: 'NO_GOAL_RELEVANT_EVENTS' })
    expect(result).toMatchObject({ mode: 'no_candidates', recommendations: [], empty_reason: 'NO_GOAL_RELEVANT_EVENTS' })
    expect(rankWithModel).not.toHaveBeenCalled()
  })

  it('does not invent why a candidate set is empty', async () => {
    await expect(recommend(input([]), options)).rejects.toThrow('domain emptyReason')
    expect(rankWithModel).not.toHaveBeenCalled()
  })

  it('rejects incomplete evidence before spending a provider request', async () => {
    const state = input([
      candidate({ candidate_id: 'GOOD' }),
      candidate({ candidate_id: 'BAD', facts: [fact('BAD-effort', 'effort')] }),
    ], { limit: 1 })
    await expect(recommend(state, options)).rejects.toThrow('required categories')
    expect(rankWithModel).not.toHaveBeenCalled()
  })

  it('rejects duplicate candidate identities even when their event IDs differ', async () => {
    const state = input([candidate({ candidate_id: 'X', event_id: 'E1' }), candidate({ candidate_id: 'X', event_id: 'E2' })])
    await expect(recommend(state, options)).rejects.toThrow('duplicate candidate IDs')
    expect(rankWithModel).not.toHaveBeenCalled()
  })

  it('passes request cancellation to the provider', async () => {
    rankWithModel.mockResolvedValue({ ok: false, reason: 'provider_error', detail: 'cancelled', ms: 0 })
    const controller = new AbortController()
    await recommend(snapshot(), { ...options, signal: controller.signal })
    expect(rankWithModel).toHaveBeenCalledWith(expect.any(Object), controller.signal)
  })
})
