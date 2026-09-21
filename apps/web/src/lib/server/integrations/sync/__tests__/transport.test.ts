import { afterEach, describe, expect, it, vi } from 'vitest'
import { integrationFetch, withSyncTransport } from '../transport'

afterEach(() => vi.restoreAllMocks())
describe('provider transport outcomes', () => {
  it.each([
    [401, 'auth_required'],
    [429, 'retry_wait'],
    [422, 'failed'],
    [503, 'uncertain'],
  ] as const)('classifies HTTP %s without a second request', async (status, state) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }))
    const result = await withSyncTransport(async () => {
      await integrationFetch('https://provider.test/items', { method: 'POST' })
      return { state: 'uncertain', errorCode: 'outcome_unknown' }
    })
    expect(result.state).toBe(state)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
  it('does not retry partial success followed by a rejection', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
    expect(
      (
        await withSyncTransport(async () => {
          await integrationFetch('https://provider.test/items', { method: 'POST' })
          await integrationFetch('https://provider.test/items/1/details', { method: 'POST' })
          return { state: 'failed', errorCode: 'provider_failed' }
        })
      ).state
    ).toBe('uncertain')
  })
  it('does not share HTTP evidence between concurrent operations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url) =>
        new Response('', {
          status: String(url).endsWith('/a') ? 429 : 201,
        })
    )
    const results = await Promise.all(
      ['a', 'b'].map((id) =>
        withSyncTransport(async () => {
          await integrationFetch(`https://provider.test/${id}`, { method: 'POST' })
          return { state: 'uncertain', errorCode: 'outcome_unknown' }
        })
      )
    )
    expect(results.map((r) => r.state)).toEqual(['retry_wait', 'uncertain'])
  })
  it('keeps a timeout uncertain even if an adapter marks it retryable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
    expect(
      (
        await withSyncTransport(async () => {
          try {
            await integrationFetch('https://provider.test/items', { method: 'POST' })
          } catch {
            /* Adapter handles errors. */
          }
          return { state: 'retry_wait', errorCode: 'unavailable' }
        })
      ).state
    ).toBe('uncertain')
  })
})
