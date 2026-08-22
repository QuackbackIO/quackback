import { describe, it, expect } from 'vitest'
import { resolvePortalOgImageUrl } from '../portal-og-image'

describe('resolvePortalOgImageUrl', () => {
  it('uses the workspace logo when set', () => {
    expect(resolvePortalOgImageUrl({ logoUrl: 'https://cdn.test/logos/logo.png' })).toBe(
      'https://cdn.test/logos/logo.png'
    )
  })

  it('falls back to the default logo when no logo is set', () => {
    expect(resolvePortalOgImageUrl({ logoUrl: null })).toBe('/logo.png')
    expect(resolvePortalOgImageUrl(null)).toBe('/logo.png')
    expect(resolvePortalOgImageUrl(undefined)).toBe('/logo.png')
  })

  it('joins a relative fallback to the supplied origin', () => {
    expect(resolvePortalOgImageUrl({ logoUrl: null }, 'https://ws-abc.quackback.co.uk')).toBe(
      'https://ws-abc.quackback.co.uk/logo.png'
    )
  })

  it('keeps an already-absolute logo URL', () => {
    expect(
      resolvePortalOgImageUrl(
        { logoUrl: 'https://ws-abc.quackback.co.uk/api/storage/logos/logo.png' },
        'https://acme.quackback.co.uk'
      )
    ).toBe('https://ws-abc.quackback.co.uk/api/storage/logos/logo.png')
  })
})
