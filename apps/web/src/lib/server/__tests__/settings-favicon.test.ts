/**
 * getSettingsFaviconData — resolves the stored favicon storage key to a
 * public URL for the admin branding form; null when no favicon is set (the
 * portal then falls back to the workspace logo, then the bundled default).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: hoisted.mockFindFirst } } },
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
    hoisted.mockFindFirst.mockResolvedValue({ faviconKey: 'favicons/duck.png' })
    expect(await getSettingsFaviconData()).toEqual({
      url: 'https://cdn.example.com/favicons/duck.png',
    })
  })

  it('returns null when no favicon key is stored', async () => {
    hoisted.mockFindFirst.mockResolvedValue({ faviconKey: null })
    expect(await getSettingsFaviconData()).toBeNull()
  })

  it('returns null when no settings record exists', async () => {
    hoisted.mockFindFirst.mockResolvedValue(undefined)
    expect(await getSettingsFaviconData()).toBeNull()
  })
})
