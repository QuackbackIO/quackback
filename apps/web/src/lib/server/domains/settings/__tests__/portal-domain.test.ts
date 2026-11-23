import { describe, expect, it } from 'vitest'
import { portalHostsOf, portalOnSite } from '../portal-domain'

describe('portalOnSite', () => {
  it('is true when a portal host shares the imported site’s registrable domain', () => {
    expect(portalOnSite('northwind.com', ['feedback.northwind.com'])).toBe(true)
    expect(portalOnSite('www.northwind.com', ['feedback.northwind.com'])).toBe(true)
    expect(portalOnSite('shop.northwind.co.uk', ['ideas.northwind.co.uk'])).toBe(true)
    expect(portalOnSite('northwind.com', ['northwind.com'])).toBe(true)
    expect(portalOnSite('NORTHWIND.com.', ['Feedback.Northwind.COM'])).toBe(true)
  })

  it('is false for another domain, however alike', () => {
    expect(portalOnSite('northwind.com', ['feedback.northwind.io'])).toBe(false)
    expect(portalOnSite('northwind.com', ['northwind.com.example.org'])).toBe(false)
    expect(portalOnSite('northwind.com', ['notnorthwind.com'])).toBe(false)
    expect(portalOnSite('northwind.co.uk', ['other.co.uk'])).toBe(false)
    expect(portalOnSite('northwind.com', [])).toBe(false)
  })

  it('never counts a shared hosting address, where a subdomain is anyone’s', () => {
    expect(portalOnSite('quackback.io', ['northwind.quackback.io'])).toBe(false)
    expect(portalOnSite('acme.up.railway.app', ['northwind.up.railway.app'])).toBe(false)
    expect(portalOnSite('acme.vercel.app', ['northwind.vercel.app'])).toBe(false)
    expect(portalOnSite('someone.github.io', ['northwind.github.io'])).toBe(false)
  })

  it('never counts a local name or an address', () => {
    expect(portalOnSite('localhost', ['localhost'])).toBe(false)
    expect(portalOnSite('10.0.0.1', ['10.0.0.1'])).toBe(false)
    expect(portalOnSite('northwind.internal', ['feedback.northwind.internal'])).toBe(false)
  })
})

describe('portalHostsOf', () => {
  const identity = (customDomains: Array<{ hostname: string; readiness: string }>) => ({
    version: 1,
    displayName: 'Northwind',
    canonicalOrigin: 'https://northwind.quackback.io',
    platformHostname: 'northwind.quackback.io',
    customDomains: customDomains.map((domain) => ({
      ...domain,
      isPrimary: true,
      updatedAt: '2026-11-01T00:00:00.000Z',
    })),
    updatedAt: '2026-11-01T00:00:00.000Z',
  })

  it('is the custom domains that are ready, never the default hosted address or a pending one', () => {
    expect(
      portalHostsOf({
        cloudIdentity: identity([
          { hostname: 'feedback.northwind.com', readiness: 'ready' },
          { hostname: 'ideas.other.com', readiness: 'pending' },
        ]),
        baseUrl: 'https://northwind.quackback.io',
      })
    ).toEqual(['feedback.northwind.com'])
    expect(
      portalHostsOf({ cloudIdentity: identity([]), baseUrl: 'https://northwind.quackback.io' })
    ).toEqual([])
  })

  it('is the install’s own address when it runs on its own', () => {
    expect(
      portalHostsOf({ cloudIdentity: null, baseUrl: 'https://feedback.northwind.com' })
    ).toEqual(['feedback.northwind.com'])
    expect(portalHostsOf({ cloudIdentity: null, baseUrl: 'not a url' })).toEqual([])
  })
})
