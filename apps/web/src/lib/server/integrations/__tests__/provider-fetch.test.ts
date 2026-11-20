/**
 * providerFetch is plain `fetch` with the same arguments unless the e2e
 * harness gate is open and a provider fake is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFetch } from '../provider-fetch'

const KEYS = ['E2E_HARNESS', 'BASE_URL', 'QUACKBACK_TENANCY', 'E2E_PROVIDER_FAKE_URL'] as const
const saved: Record<string, string | undefined> = {}
const fetchMock = vi.fn(async () => new Response('{}'))

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key]
  process.env.BASE_URL = 'http://acme.localhost:3000'
  process.env.E2E_PROVIDER_FAKE_URL = 'http://127.0.0.1:4013'
  delete process.env.E2E_HARNESS
  delete process.env.QUACKBACK_TENANCY
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('providerFetch', () => {
  it('calls fetch with exactly the same arguments when the gate is closed', async () => {
    const init = { method: 'POST', body: '{}' }
    await providerFetch('https://api.linear.app/graphql', init)
    expect(fetchMock).toHaveBeenCalledWith('https://api.linear.app/graphql', init)
    // The very same init object, not a copy.
    expect((fetchMock.mock.lastCall as unknown as [string, RequestInit])[1]).toBe(init)

    const url = new URL('https://api.github.com/user')
    await providerFetch(url)
    expect(fetchMock).toHaveBeenLastCalledWith(url)
    expect(fetchMock.mock.lastCall).toHaveLength(1)
  })

  it('reaches the real provider on a public BASE_URL even with the flag and a fake set', async () => {
    process.env.E2E_HARNESS = '1'
    process.env.BASE_URL = 'https://feedback.example.com'
    await providerFetch('https://api.linear.app/graphql', { method: 'POST' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.linear.app/graphql', { method: 'POST' })
  })

  it('sends a provider request to the fake behind the gate', async () => {
    process.env.E2E_HARNESS = '1'
    const init = { method: 'POST', body: '{}' }
    await providerFetch('https://api.linear.app/graphql', init)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4013/api.linear.app/graphql', init)
    expect((fetchMock.mock.lastCall as unknown as [string, RequestInit])[1]).toBe(init)
  })

  it('keeps a Request input a Request, aimed at the fake', async () => {
    process.env.E2E_HARNESS = '1'
    await providerFetch(new Request('https://discord.com/api/v10/users/@me', { method: 'GET' }))
    const [target] = fetchMock.mock.lastCall as unknown as [Request]
    expect(target).toBeInstanceOf(Request)
    expect(target.url).toBe('http://127.0.0.1:4013/discord.com/api/v10/users/@me')
  })

  it('leaves a host outside the map alone behind the gate', async () => {
    process.env.E2E_HARNESS = '1'
    await providerFetch('https://api.example.com/x', { method: 'GET' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/x', { method: 'GET' })
  })
})
