import { afterEach, describe, expect, it, vi } from 'vitest'
import { candidate, input } from './fixtures'

const create = vi.hoisted(() => vi.fn())
const construct = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      construct(options)
    }
    chat = { completions: { create } }
  },
}))

const { getModel, getTimeoutMs, isAiConfigured, rankWithModel, resetClientForTests } = await import(
  '../../src/server/ai/adapter'
)

const snapshot = input([candidate({ candidate_id: 'C1' })])
const successfulResponse = {
  choices: [{
    finish_reason: 'stop',
    message: {
      content: JSON.stringify({
        choices: [{
          candidate_id: 'C1',
          reason_fact_ids: ['C1-gap'],
          alternative_candidate_id: null,
        }],
      }),
    },
  }],
}

afterEach(() => {
  create.mockReset()
  construct.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  resetClientForTests()
})

describe('configuration', () => {
  it('reports ai_configured from the presence of a key, not a live check', () => {
    vi.stubEnv('LLM_API_KEY', '')
    expect(isAiConfigured()).toBe(false)
    vi.stubEnv('LLM_API_KEY', '  \t ')
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

  it.each(['5000ms', '1e3', '1.5', '-1', '0', 'Infinity', '0x20', ''])(
    'rejects malformed or non-positive timeout %s',
    (configured) => {
      vi.stubEnv('LLM_TIMEOUT_MS', configured)
      expect(getTimeoutMs()).toBe(8000)
    },
  )

  it('caps the provider budget at eight seconds', () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '60000')
    expect(getTimeoutMs()).toBe(8000)
  })
})

describe('rankWithModel', () => {
  it('reports missing_api_key without calling the provider', async () => {
    vi.stubEnv('LLM_API_KEY', '  \t ')
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'missing_api_key' })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns parsed output on success', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue(successfulResponse)
    const result = await rankWithModel(snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toMatchObject({ choices: [{ candidate_id: 'C1' }] })
  })

  it('maps a provider failure to provider_error rather than throwing', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockRejectedValue(new Error('503 service unavailable: secret sk-test'))
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({
      ok: false,
      reason: 'provider_error',
      detail: 'provider request failed',
    })
    expect(JSON.stringify(result)).not.toContain('sk-test')
  })

  it('maps non-JSON content to invalid_response', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue({ choices: [{ message: { content: 'sorry, I cannot' } }] })
    const result = await rankWithModel(snapshot)
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' })
  })

  it('settles at the deadline even when the provider ignores abort', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_TIMEOUT_MS', '40')
    create.mockReturnValue(new Promise(() => {}))
    const pending = rankWithModel(snapshot)
    await vi.advanceTimersByTimeAsync(40)
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout', ms: 40 })
    expect(create.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces the deadline even when a larger timeout is configured', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_TIMEOUT_MS', '60000')
    create.mockReturnValue(new Promise(() => {}))
    const pending = rankWithModel(snapshot)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout', ms: 8000 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes a bounded SDK timeout and disables hidden retries', async () => {
    vi.stubEnv('LLM_API_KEY', '  sk-test  ')
    vi.stubEnv('LLM_TIMEOUT_MS', '2000')
    create.mockResolvedValue(successfulResponse)
    await rankWithModel(snapshot)
    expect(construct).toHaveBeenCalledWith({ apiKey: 'sk-test', maxRetries: 0 })
    expect(create.mock.calls[0][1]).toMatchObject({ timeout: 2000, maxRetries: 0 })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('reuses the client until its API key changes', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-first')
    create.mockResolvedValue(successfulResponse)
    await rankWithModel(snapshot)
    await rankWithModel(snapshot)
    expect(construct).toHaveBeenCalledTimes(1)
    vi.stubEnv('LLM_API_KEY', 'sk-second')
    await rankWithModel(snapshot)
    expect(construct).toHaveBeenCalledTimes(2)
    expect(construct).toHaveBeenLastCalledWith({ apiKey: 'sk-second', maxRetries: 0 })
  })

  it('does not call the provider when the caller already cancelled', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    const controller = new AbortController()
    controller.abort()
    expect(await rankWithModel(snapshot, controller.signal)).toMatchObject({
      ok: false,
      reason: 'provider_error',
      detail: 'request cancelled',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('settles on caller cancellation and observes a late provider rejection', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    const controller = new AbortController()
    let rejectProvider!: (reason: Error) => void
    create.mockReturnValue(new Promise((_resolve, reject) => { rejectProvider = reject }))
    const pending = rankWithModel(snapshot, controller.signal)
    controller.abort(new Error('private caller detail'))
    expect(await pending).toMatchObject({
      ok: false,
      reason: 'provider_error',
      detail: 'request cancelled',
    })
    expect(create.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    rejectProvider(new Error('late secret provider error'))
    await vi.advanceTimersByTimeAsync(0)
  })

  it.each(['success', 'failure'])('cleans timers and caller listeners on %s', async (outcome) => {
    vi.useFakeTimers()
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    if (outcome === 'success') create.mockResolvedValue(successfulResponse)
    else create.mockRejectedValue(new Error('provider failure'))
    await rankWithModel(snapshot, controller.signal)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0][1])
    controller.abort()
    expect(create.mock.calls[0][1].signal.aborted).toBe(false)
  })

  it.each([
    { label: 'missing choices', response: {} },
    { label: 'null response', response: null },
    { label: 'missing message', response: { choices: [{}] } },
    { label: 'blank content', response: { choices: [{ message: { content: '  ' } }] } },
    { label: 'non-text content', response: { choices: [{ message: { content: {} } }] } },
  ])('rejects $label as invalid_response', async ({ response }) => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue(response)
    expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'invalid_response' })
  })

  it('rejects a refusal without exposing its text', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    create.mockResolvedValue({
      choices: [{ message: { content: '{}', refusal: 'private refusal text' } }],
    })
    expect(await rankWithModel(snapshot)).toMatchObject({
      ok: false,
      reason: 'invalid_response',
      detail: 'provider refused completion',
    })
  })

  it.each(['length', 'content_filter', 'tool_calls'])(
    'rejects finish_reason=%s even when the content is valid JSON',
    async (finishReason) => {
      vi.stubEnv('LLM_API_KEY', 'sk-test')
      create.mockResolvedValue({
        choices: [{ finish_reason: finishReason, message: { content: '{}' } }],
      })
      expect(await rankWithModel(snapshot)).toMatchObject({ ok: false, reason: 'invalid_response' })
    },
  )

  it('observes a provider rejection arriving after the deadline', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_TIMEOUT_MS', '20')
    let rejectProvider!: (reason: Error) => void
    create.mockReturnValue(new Promise((_resolve, reject) => { rejectProvider = reject }))
    const pending = rankWithModel(snapshot)
    await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toMatchObject({ ok: false, reason: 'provider_timeout' })
    rejectProvider(new Error('late provider error'))
    await vi.advanceTimersByTimeAsync(0)
  })

  it('never calls the provider for an empty candidate set', async () => {
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    await rankWithModel(input([]))
    expect(create).not.toHaveBeenCalled()
  })
})
