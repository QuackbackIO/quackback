import { describe, it, expect } from 'vitest'
import { captureCountryFromHeaders } from '../country-capture'

describe('captureCountryFromHeaders', () => {
  it('reads Cloudflare CF-IPCountry', () => {
    const h = new Headers({ 'cf-ipcountry': 'US' })
    expect(captureCountryFromHeaders(h)).toBe('US')
  })

  it('reads Vercel X-Vercel-IP-Country', () => {
    const h = new Headers({ 'x-vercel-ip-country': 'GB' })
    expect(captureCountryFromHeaders(h)).toBe('GB')
  })

  it('reads Fly.io Fly-Client-IP-Country', () => {
    const h = new Headers({ 'fly-client-ip-country': 'DE' })
    expect(captureCountryFromHeaders(h)).toBe('DE')
  })

  it('reads generic X-Country-Code', () => {
    const h = new Headers({ 'x-country-code': 'AU' })
    expect(captureCountryFromHeaders(h)).toBe('AU')
  })

  it('normalizes lowercase to uppercase', () => {
    const h = new Headers({ 'cf-ipcountry': 'fr' })
    expect(captureCountryFromHeaders(h)).toBe('FR')
  })

  it('trims surrounding whitespace', () => {
    const h = new Headers({ 'cf-ipcountry': '  CA  ' })
    expect(captureCountryFromHeaders(h)).toBe('CA')
  })

  it('returns null when no recognised header is present', () => {
    const h = new Headers({ 'x-some-other-header': 'foo' })
    expect(captureCountryFromHeaders(h)).toBeNull()
  })

  it('rejects values longer than 2 letters', () => {
    const h = new Headers({ 'cf-ipcountry': 'USA' })
    expect(captureCountryFromHeaders(h)).toBeNull()
  })

  it('rejects values with non-letter characters', () => {
    const h = new Headers({ 'cf-ipcountry': 'U1' })
    expect(captureCountryFromHeaders(h)).toBeNull()
  })

  it('drops CDN sentinels for unknown country ("XX")', () => {
    // Cloudflare returns XX for Tor exit nodes / requests it cannot geolocate.
    const h = new Headers({ 'cf-ipcountry': 'XX' })
    expect(captureCountryFromHeaders(h)).toBeNull()
  })

  it('drops CDN sentinels for Tor traffic ("T1")', () => {
    const h = new Headers({ 'cf-ipcountry': 'T1' })
    expect(captureCountryFromHeaders(h)).toBeNull()
  })

  it('prefers earlier header when multiple are set (CF before Vercel)', () => {
    const h = new Headers({
      'cf-ipcountry': 'US',
      'x-vercel-ip-country': 'GB',
    })
    expect(captureCountryFromHeaders(h)).toBe('US')
  })

  it('falls through to the next header when the first is a sentinel', () => {
    const h = new Headers({
      'cf-ipcountry': 'XX',
      'x-vercel-ip-country': 'GB',
    })
    expect(captureCountryFromHeaders(h)).toBe('GB')
  })
})
