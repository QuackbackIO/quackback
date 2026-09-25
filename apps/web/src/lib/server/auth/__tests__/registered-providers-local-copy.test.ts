/**
 * The registered-provider list rides the workspace settings' local window.
 *
 * Every document's bootstrap asks for it. Read from the key-value cache on each
 * request, it cost every document a round trip, and its five-minute expiry made
 * whichever request came next rebuild it, so a page's query count depended on
 * when it was loaded. Held in this process for the same few seconds as the
 * settings it is derived from, a busy process skips those reads, and a write
 * through this process still drops the copy at once. Driven through the real
 * cache layer; only the key-value statements and the inputs of a rebuild are
 * faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'auth:registered-providers'

const kvRows = new Map<string, unknown>()
const mockKvGet = vi.fn(async (key: string) => structuredClone(kvRows.get(key) ?? null))
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: (key: string) => mockKvGet(key),
  kvSet: vi.fn(async (key: string, value: unknown) => void kvRows.set(key, value)),
  kvDel: vi.fn(async (...keys: string[]) => keys.forEach((k) => kvRows.delete(k))),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({ authConfig: { oauth: {} } })),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: { customOidcProvider: false } })),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
}))

const { getRegisteredAuthProviders } = await import('../registered-providers')
const { cacheDel } = await import('@/lib/server/cache')
const { forgetCachedKeys, SETTINGS_LOCAL_TTL_MS: WINDOW_MS } =
  await import('@/lib/server/local-cache')
const { runWithLogContext } = await import('@/lib/server/log-context')

const inRequest = <T>(fn: () => Promise<T>) =>
  runWithLogContext({ request_id: crypto.randomUUID() }, fn)
const providerReads = () => mockKvGet.mock.calls.filter(([key]) => key === KEY).length

beforeEach(() => {
  vi.clearAllMocks()
  forgetCachedKeys(KEY)
  kvRows.clear()
  kvRows.set(KEY, ['github'])
  vi.stubEnv('NODE_ENV', 'production')
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('getRegisteredAuthProviders across requests, in production', () => {
  it('serves the requests inside the settings window from this process', async () => {
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual(['github'])
    vi.advanceTimersByTime(WINDOW_MS - 1)
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual(['github'])
    expect(providerReads()).toBe(1)
  })

  it('sees a change made by another process once the window has passed', async () => {
    await inRequest(() => getRegisteredAuthProviders())
    kvRows.set(KEY, ['github', 'google'])
    vi.advanceTimersByTime(WINDOW_MS + 1)
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual(['github', 'google'])
    expect(providerReads()).toBe(2)
  })

  it('sees an invalidation made through this process at once', async () => {
    await inRequest(() => getRegisteredAuthProviders())
    await inRequest(() => cacheDel(KEY))
    kvRows.set(KEY, ['google'])
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual(['google'])
  })

  it('keeps a rebuilt list, so the next request neither reads nor rebuilds it', async () => {
    kvRows.clear()
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual([])
    expect(kvRows.get(KEY)).toEqual([])
    await inRequest(() => getRegisteredAuthProviders())
    expect(providerReads()).toBe(1)
  })

  it('takes its window from QUACKBACK_SETTINGS_CACHE_MS, where 0 turns the copy off', async () => {
    vi.stubEnv('QUACKBACK_SETTINGS_CACHE_MS', '0')
    await inRequest(() => getRegisteredAuthProviders())
    await inRequest(() => getRegisteredAuthProviders())
    expect(providerReads()).toBe(2)

    vi.stubEnv('QUACKBACK_SETTINGS_CACHE_MS', String(60 * 60 * 1000))
    await inRequest(() => getRegisteredAuthProviders())
    vi.advanceTimersByTime(10 * 60 * 1000)
    await inRequest(() => getRegisteredAuthProviders())
    expect(providerReads()).toBe(3)
  })

  it('hands every caller a list of its own', async () => {
    const first = await inRequest(() => getRegisteredAuthProviders())
    first.push('mutated by a caller')
    expect(await inRequest(() => getRegisteredAuthProviders())).toEqual(['github'])
  })
})
