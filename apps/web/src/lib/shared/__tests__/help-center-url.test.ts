import { describe, it, expect } from 'vitest'
import { getHelpCenterBaseUrl } from '../help-center-url'

describe('getHelpCenterBaseUrl', () => {
  it('returns custom domain URL when customDomain is set and verified', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: { customDomain: 'help.example.com', domainVerified: true },
      slug: 'acme',
    })
    expect(url).toBe('https://help.example.com')
  })

  it('returns custom domain URL even when not verified', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: { customDomain: 'help.example.com', domainVerified: false },
      slug: 'acme',
    })
    expect(url).toBe('https://help.example.com')
  })

  it('falls back to convention subdomain when customDomain is null', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: { customDomain: null, domainVerified: false },
      slug: 'acme',
    })
    expect(url).toBe('https://help.acme.quackback.app')
  })

  it('returns convention subdomain URL when no custom domain', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: null,
      slug: 'acme',
    })
    expect(url).toBe('https://help.acme.quackback.app')
  })

  it('returns /help fallback when no slug is available', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: null,
      slug: null,
    })
    expect(url).toBe('/help')
  })

  it('returns /help fallback when settings is null', () => {
    const url = getHelpCenterBaseUrl(null)
    expect(url).toBe('/help')
  })

  it('returns /help fallback when slug is empty string', () => {
    const url = getHelpCenterBaseUrl({
      helpCenterConfig: null,
      slug: '',
    })
    expect(url).toBe('/help')
  })
})
