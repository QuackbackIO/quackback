import { describe, it, expect } from 'vitest'
import { resolvePortalOgImageUrl } from '../portal-og-image'

describe('resolvePortalOgImageUrl', () => {
  it('prefers the custom OG image when set', () => {
    expect(
      resolvePortalOgImageUrl({
        ogImageUrl: 'https://cdn.test/portal-og/og.png',
        logoUrl: 'https://cdn.test/logos/logo.png',
      })
    ).toBe('https://cdn.test/portal-og/og.png')
  })

  it('falls back to the workspace logo when no OG image is set', () => {
    expect(
      resolvePortalOgImageUrl({ ogImageUrl: null, logoUrl: 'https://cdn.test/logos/logo.png' })
    ).toBe('https://cdn.test/logos/logo.png')
  })

  it('falls back to the default logo when neither is set', () => {
    expect(resolvePortalOgImageUrl({ ogImageUrl: null, logoUrl: null })).toBe('/logo.png')
    expect(resolvePortalOgImageUrl(null)).toBe('/logo.png')
    expect(resolvePortalOgImageUrl(undefined)).toBe('/logo.png')
  })
})
