// @vitest-environment node
/**
 * AI_CHAT_OPTIONS keeps TanStack AI from printing a provider's error (which can
 * quote the request) to the console before the caller's own catch runs. This
 * drives the real chat() against a fake provider that answers 400.
 */
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { AI_CHAT_OPTIONS } from '../chat-options'

const CANARY = 'SECRET_PROVIDER_BODY'

function failingAdapter() {
  const fetch = async () =>
    Response.json(
      { error: { message: `bad request ${CANARY}`, type: 'invalid_request' } },
      { status: 400 }
    )
  return openaiCompatibleText('m', {
    apiKey: 'unused',
    baseURL: 'https://gateway.example/v1',
    maxRetries: 0,
    fetch: fetch as unknown as typeof globalThis.fetch,
  })
}

function consoleOutput(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return inspect(
    spies.flatMap((spy) => spy.mock.calls),
    { depth: 8 }
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AI_CHAT_OPTIONS', () => {
  it('turns library debug output off', () => {
    expect(AI_CHAT_OPTIONS).toEqual({ debug: false })
  })

  it('leaves a failed chat() call silent on the console and still rejects', async () => {
    const spies = (['error', 'warn', 'info', 'log', 'debug', 'dir'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )

    await expect(
      chat({
        ...AI_CHAT_OPTIONS,
        adapter: failingAdapter(),
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      })
    ).rejects.toBeDefined()

    expect(consoleOutput(spies)).not.toContain(CANARY)
  })
})
