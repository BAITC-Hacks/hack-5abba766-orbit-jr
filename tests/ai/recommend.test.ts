import { afterEach, describe, expect, it, vi } from 'vitest'
import { candidate, gain, input } from './fixtures'

const callRanking = vi.hoisted(() => vi.fn())

vi.mock('@/server/ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ai/provider')>()
  return { ...actual, callRanking }
})

const { recommend } = await import('@/server/ai/recommend')

const base = input([
  candidate({ event_id: 'EV_1', expected_changes: [gain('SK_1', 2, 3, true, true)] }),
  candidate({ event_id: 'EV_2', expected_changes: [gain('SK_2', 1, 2)] }),
])

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('recommend', () => {
  it('returns mode "ai" when the model answers acceptably', async () => {
    callRanking.mockResolvedValue({
      ms: 1200,
      raw: {
        ranked: [
          {
            event_id: 'EV_2',
            fact_ids: ['EV_2-f1', 'EV_2-f2', 'EV_2-f3'],
            compared_to_event_id: null,
            note: null,
          },
        ],
      },
    })
    const result = await recommend(base)
    expect(result.mode).toBe('ai')
    expect(result.cards.map((c) => c.event_id)).toEqual(['EV_2'])
    expect(result.diagnostics.llm_ms).toBe(1200)
    expect(result.state_version).toBe(7)
  })

  it('falls back to rules when the provider throws', async () => {
    callRanking.mockRejectedValue(new Error('502 bad gateway'))
    const result = await recommend(base)
    expect(result.mode).toBe('rules_fallback')
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.diagnostics.rejection).toContain('provider error')
  })

  it('falls back to rules when the model answer does not validate', async () => {
    callRanking.mockResolvedValue({
      ms: 900,
      raw: { ranked: [{ event_id: 'EV_404', fact_ids: ['x'], compared_to_event_id: null, note: null }] },
    })
    const result = await recommend(base)
    expect(result.mode).toBe('rules_fallback')
    expect(result.diagnostics.rejection).toContain('unknown event_id')
    // the timing of the wasted call is still reported
    expect(result.diagnostics.llm_ms).toBe(900)
  })

  it('aborts and falls back when the model is slower than the budget', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '50')
    callRanking.mockImplementation(
      (_input: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const result = await recommend(base)
    expect(result.mode).toBe('rules_fallback')
    expect(result.diagnostics.rejection).toContain('timeout')
  })

  it('returns an empty list with a reason when nothing is eligible', async () => {
    const result = await recommend(input([]))
    expect(result.cards).toEqual([])
    expect(result.reason).toContain('no eligible')
    expect(callRanking).not.toHaveBeenCalled()
  })
})
