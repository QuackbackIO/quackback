/**
 * Regression: `unfurlLinkFn` read the feature flag off the raw settings
 * row, where `featureFlags` is an unparsed JSON *string* (text column).
 * `(string).linkPreviews` is always undefined, so the gate returned null
 * for every URL and link previews never rendered, flag on or off.
 *
 * This pins the gate's behavior at the handler boundary: with the
 * tenant flag enabled the handler unfurls; with it disabled it returns
 * null without fetching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetSettings: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockUnfurlExternalUrl: vi.fn(),
  mockCacheGet: vi.fn(),
  mockCacheSet: vi.fn(),
  mockGetRedis: vi.fn(),
  mockGetClientIp: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

// Raw row shape: featureFlags is a JSON string, exactly as the text column
// comes back from the DB. A gate reading it as an object silently fails.
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: hoisted.mockGetSettings,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: hoisted.mockIsFeatureEnabled,
}))

vi.mock('@/lib/server/content/unfurl', () => ({
  unfurlExternalUrl: hoisted.mockUnfurlExternalUrl,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheGet: hoisted.mockCacheGet,
  cacheSet: hoisted.mockCacheSet,
  getRedis: hoisted.mockGetRedis,
}))

vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  getClientIp: hoisted.mockGetClientIp,
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => ({}),
}))

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

let unfurlLinkHandler: AnyHandler

const rawSettingsRow = (flags: Record<string, boolean>) => ({
  id: 'settings_1',
  name: 'Acme',
  featureFlags: JSON.stringify(flags),
})

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'usr_1' },
    principal: { id: 'prn_1', role: 'admin' },
  })
  hoisted.mockGetClientIp.mockReturnValue('203.0.113.7')
  hoisted.mockGetRedis.mockReturnValue({
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  })
  hoisted.mockCacheGet.mockResolvedValue(null)
  hoisted.mockCacheSet.mockResolvedValue(undefined)
  if (handlers.length === 0) await import('../link-preview')
  unfurlLinkHandler = handlers[0]
})

describe('unfurlLinkFn — feature flag gate', () => {
  it('unfurls when the linkPreviews flag is enabled', async () => {
    hoisted.mockGetSettings.mockResolvedValue(rawSettingsRow({ linkPreviews: true }))
    hoisted.mockIsFeatureEnabled.mockResolvedValue(true)
    const preview = {
      url: 'https://news.example/post',
      title: 'A headline',
      description: null,
      siteName: null,
      imageUrl: null,
    }
    hoisted.mockUnfurlExternalUrl.mockResolvedValue(preview)

    const result = await unfurlLinkHandler({ data: { url: 'https://news.example/post' } })

    expect(result).toEqual(preview)
    expect(hoisted.mockIsFeatureEnabled).toHaveBeenCalledWith('linkPreviews')
    expect(hoisted.mockUnfurlExternalUrl).toHaveBeenCalledWith('https://news.example/post')
  })

  it('returns null without fetching when the flag is disabled', async () => {
    hoisted.mockGetSettings.mockResolvedValue(rawSettingsRow({ linkPreviews: false }))
    hoisted.mockIsFeatureEnabled.mockResolvedValue(false)

    const result = await unfurlLinkHandler({ data: { url: 'https://news.example/post' } })

    expect(result).toBeNull()
    expect(hoisted.mockUnfurlExternalUrl).not.toHaveBeenCalled()
  })
})
