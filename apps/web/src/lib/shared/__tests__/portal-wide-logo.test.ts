import { describe, expect, it } from 'vitest'
import { portalWideLogoUrl } from '../portal-wide-logo'

describe('portalWideLogoUrl', () => {
  const url = '/api/storage/header-logos/wordmark.svg'

  it('is the header logo when the header shows the wide logo', () => {
    expect(portalWideLogoUrl({ headerDisplayMode: 'custom_logo', headerLogoUrl: url })).toBe(url)
  })

  it('is null in every other mode, so the square logo and name show', () => {
    for (const mode of ['logo_and_name', 'logo_only', null, undefined, 'something-else']) {
      expect(
        portalWideLogoUrl({ headerDisplayMode: mode, headerLogoUrl: url }),
        String(mode)
      ).toBeNull()
    }
  })

  it('is null without a header logo, whatever the mode', () => {
    expect(portalWideLogoUrl({ headerDisplayMode: 'custom_logo', headerLogoUrl: null })).toBeNull()
    expect(portalWideLogoUrl(null)).toBeNull()
    expect(portalWideLogoUrl(undefined)).toBeNull()
  })
})
