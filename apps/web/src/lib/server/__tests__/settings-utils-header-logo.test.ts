/**
 * The header logo read gives the Customise editor the stored key as well as
 * its address: a publish names the wide logo it replaces by its key.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  findSettingsCached: async () => ({
    headerLogoKey: 'header-logos/2026/11/abc-wordmark.svg',
    headerDisplayMode: 'custom_logo',
    headerDisplayName: null,
    portalConfig: JSON.stringify({ headerLogoDarkKey: 'header-logos/2026/11/abc-dark.svg' }),
  }),
  parsePortalConfig: (raw: string | null) => (raw ? JSON.parse(raw) : {}),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `/api/storage/${key}` : null),
}))

const { getSettingsHeaderLogoData } = await import('../settings-utils')

describe('getSettingsHeaderLogoData', () => {
  it('returns the stored key and its dark mode version with the address and display mode', async () => {
    expect(await getSettingsHeaderLogoData()).toEqual({
      key: 'header-logos/2026/11/abc-wordmark.svg',
      url: '/api/storage/header-logos/2026/11/abc-wordmark.svg',
      darkKey: 'header-logos/2026/11/abc-dark.svg',
      displayMode: 'custom_logo',
      displayName: null,
    })
  })
})
