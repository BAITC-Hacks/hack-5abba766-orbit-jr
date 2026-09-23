import { afterEach, describe, expect, it, vi } from 'vitest'
import { candidate, input } from './fixtures'

const create = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

const { getModel, getTimeoutMs, isAiConfigured, rankWithModel, resetClientForTests } = await import(
  '../../src/server/ai/adapter'
)

const snapshot = input([candidate({ candidate_id: 'C1' })])

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  resetClientForTests()
})

describe('configuration', () => {
  it('reports ai_configured from the presence of a key, not a live check', () => {
    vi.stubEnv('LLM_API_KEY', '')
    expect(isAiConfigured()).toBe(false)
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    expect(isAiConfigured()).toBe(true)
  })

  it('falls back to defaults for model and timeout', () => {
    vi.stubEnv('LLM_MODEL', '')
    vi.stubEnv('LLM_TIMEOUT_MS', 'not-a-number')
    expect(getModel()).toBe('gpt-4o-mini')
    expect(getTimeoutMs()).toBe(8000)
  })

  it('reads model and timeout from the environment', () => {
    vi.stubEnv('LLM_MODEL', 'gpt-4.1')
    vi.stubEnv('LLM_TIMEOUT_MS', '5000')
    expect(getModel()).toBe('gpt-4.1')
    expect(getTimeoutMs()).toBe(5000)
  })
})

describe('rankWithModel', () => {
  it('reports missing_api_key without calling the provider', async () => {
    vi.stubEnv('LLM_API_KEY', '')
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'missing_api_key' })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns parsed output on success', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue({
      choices: [{ message: { content: '{"choices":[{"candidate_id":"C1","reason_fact_ids":["C1-gap"],"alternative_candidate_id":null}]}' } }],
    })
    const result = await rankWithModel(snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toMatchObject({ choices: [{ candidate_id: 'C1' }] })
  })

  it('maps a provider failure to provider_error rather than throwing', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockRejectedValue(new Error('503 service unavailable'))
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'provider_error' })
  })

  it('maps non-JSON content to invalid_response', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue({ choices: [{ message: { content: 'sorry, I cannot' } }] })
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' })
  })

  it('aborts at the configured budget and reports provider_timeout', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_TIMEOUT_MS', '40')
    create.mockImplementation(
      (_params: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'provider_timeout' })
  })

  it('never calls the provider for an empty candidate set', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    await rankWithModel(input([]))
    expect(create).not.toHaveBeenCalled()
  })
})
