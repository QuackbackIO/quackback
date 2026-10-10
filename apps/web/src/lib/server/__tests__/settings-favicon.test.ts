/**
 * getSettingsFaviconData — resolves the stored favicon storage key to a
 * public URL for the admin branding form; null when no favicon is set (the
 * portal then falls back to the workspace logo, then the bundled default).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockFindSettings: vi.fn(),
}))

// The readers take the settings row the request already holds.
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  findSettingsCached: hoisted.mockFindSettings,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.example.com/${key}` : null),
}))

const { getSettingsFaviconData } = await import('../settings-utils')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSettingsFaviconData', () => {
  it('returns the public URL for a stored favicon key', async () => {
    hoisted.mockFindSettings.mockResolvedValue({ faviconKey: 'favicons/duck.png' })
    expect(await getSettingsFaviconData()).toEqual({
      url: 'https://cdn.example.com/favicons/duck.png',
    })
  })

  it('returns null when no favicon key is stored', async () => {
    hoisted.mockFindSettings.mockResolvedValue({ faviconKey: null })
    expect(await getSettingsFaviconData()).toBeNull()
  })

  it('returns null when no settings record exists', async () => {
    hoisted.mockFindSettings.mockResolvedValue(null)
    expect(await getSettingsFaviconData()).toBeNull()
  })
})
