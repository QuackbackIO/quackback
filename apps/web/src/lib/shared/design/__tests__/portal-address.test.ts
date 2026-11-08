import { describe, expect, it } from 'vitest'
import { portalAddress } from '../portal-address'

const cloud = (customDomains: Array<{ hostname: string; readiness: string }> = []) => ({
  platformHostname: 'acme.quackback.io',
  canonicalOrigin: 'https://acme.quackback.io',
  customDomains,
})

describe('portalAddress', () => {
  it('is the live address, offering a domain of its own on Cloud while there is none', () => {
    expect(portalAddress('https://acme.quackback.io', cloud(), true)).toEqual({
      url: 'https://acme.quackback.io',
      offerDomain: true,
    })
  })

  it('offers no domain once one is set up', () => {
    const set = cloud([{ hostname: 'feedback.acme.com', readiness: 'ready' }])
    expect(portalAddress('https://feedback.acme.com', set, true).offerDomain).toBe(false)
  })

  it('offers no domain to someone who cannot set one up, or on a self-hosted install', () => {
    expect(portalAddress('https://acme.quackback.io', cloud(), false).offerDomain).toBe(false)
    expect(portalAddress('https://feedback.acme.com', null, true).offerDomain).toBe(false)
  })
})
