import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isSafeScheme, isPrivateAddress, checkUrlSafety } from '../ssrf-guard'

vi.mock('node:dns/promises', () => ({
  default: {},
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>

describe('isSafeScheme', () => {
  it('accepts https and http', () => {
    expect(isSafeScheme('https://example.com/img.png')).toBe(true)
    expect(isSafeScheme('http://example.com/img.png')).toBe(true)
  })

  it('rejects file, ftp, gopher, dict, ldap, javascript', () => {
    expect(isSafeScheme('file:///etc/passwd')).toBe(false)
    expect(isSafeScheme('ftp://example.com/x')).toBe(false)
    expect(isSafeScheme('gopher://example.com/')).toBe(false)
    expect(isSafeScheme('dict://example.com/')).toBe(false)
    expect(isSafeScheme('ldap://example.com/')).toBe(false)
    expect(isSafeScheme('javascript:alert(1)')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeScheme('not a url')).toBe(false)
    expect(isSafeScheme('')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('blocks IPv4 loopback and link-local', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('127.255.255.254')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
  })

  it('blocks RFC 1918 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.254')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
  })

  it('blocks this-network and CGNAT', () => {
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
  })

  it('blocks IPv6 loopback, unique-local, link-local', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('fc00::1')).toBe(true)
    expect(isPrivateAddress('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
  })

  it('blocks IPv4-mapped IPv6 private addresses', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows IPv4-mapped IPv6 public addresses', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
    expect(isPrivateAddress('::ffff:1.1.1.1')).toBe(false)
  })

  it('blocks the IPv6 documentation prefix 2001:db8::/32', () => {
    expect(isPrivateAddress('2001:db8::1')).toBe(true)
    expect(isPrivateAddress('2001:0db8:1234::1')).toBe(true)
  })

  it('blocks hextet-form IPv4-mapped IPv6 private addresses', () => {
    // ::ffff:7f00:1 encodes 127.0.0.1
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true)
    // ::ffff:0a00:1 encodes 10.0.0.1
    expect(isPrivateAddress('::ffff:0a00:1')).toBe(true)
    // ::ffff:c0a8:1 encodes 192.168.0.1
    expect(isPrivateAddress('::ffff:c0a8:1')).toBe(true)
    // ::ffff:a9fe:a9fe encodes 169.254.169.254 (cloud metadata)
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true)
    // ::ffff:ac10:1 encodes 172.16.0.1
    expect(isPrivateAddress('::ffff:ac10:1')).toBe(true)
  })

  it('allows hextet-form IPv4-mapped IPv6 public addresses', () => {
    // ::ffff:0808:0808 encodes 8.8.8.8
    expect(isPrivateAddress('::ffff:0808:0808')).toBe(false)
    // ::ffff:0101:0101 encodes 1.1.1.1
    expect(isPrivateAddress('::ffff:0101:0101')).toBe(false)
  })
})

describe('checkUrlSafety', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('returns safe:true + the pinned address for a public host', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])

    const result = await checkUrlSafety('https://example.com/img.png')
    expect(result).toEqual({
      safe: true,
      address: '93.184.216.34',
      family: 4,
    })
  })

  it('rejects when any resolved address is private', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    const result = await checkUrlSafety('https://evil.example.com/img.png')
    expect(result).toEqual({ safe: false, reason: 'ssrf-rejected' })
  })

  it('rejects disallowed schemes without looking up', async () => {
    const result = await checkUrlSafety('file:///etc/passwd')
    expect(result).toEqual({ safe: false, reason: 'scheme-rejected' })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects when DNS lookup throws', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await checkUrlSafety('https://does-not-exist.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })

  it('rejects when DNS returns zero addresses', async () => {
    lookupMock.mockResolvedValueOnce([])
    const result = await checkUrlSafety('https://empty.example/')
    expect(result).toEqual({ safe: false, reason: 'dns-error' })
  })
})
