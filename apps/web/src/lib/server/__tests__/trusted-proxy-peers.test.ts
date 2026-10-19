/**
 * parseTrustedProxyCidrs() and isTrustedProxyPeer(): the CIDR list behind
 * TRUSTED_PROXY_CIDRS. A list is accepted whole or refused; an unusable peer or
 * entry never matches.
 */
import { describe, it, expect } from 'vitest'
import { parseTrustedProxyCidrs, isTrustedProxyPeer } from '../trusted-proxy-peers'

describe('parseTrustedProxyCidrs', () => {
  it.each([undefined, '', '   '])('treats %j as no list', (raw) => {
    expect(parseTrustedProxyCidrs(raw)).toEqual({ ok: true, cidrs: [] })
  })

  it('accepts addresses with and without a prefix, IPv4 and IPv6', () => {
    expect(parseTrustedProxyCidrs(' 10.0.0.0/8 , 192.0.2.7,2001:db8::/32, ::1 ')).toEqual({
      ok: true,
      cidrs: ['10.0.0.0/8', '192.0.2.7', '2001:db8::/32', '::1'],
    })
  })

  it.each([
    'garbage',
    '192.0.2.0/invalid',
    '192.0.2.0/33',
    '2001:db8::/129',
    '192.0.2.0/24/4',
    '192.0.2.0/',
    '192.0.2.0/ ',
    '192.0.2.0/+0',
    '192.0.2.0/1e1',
    '192.0.2.0/-1',
    '2001:db8::/',
    '10.0.0.0/8,',
    '10.0.0.0/8,,172.16.0.0/12',
    'fe80::1%eth0',
    'fe80::1%eth0/64',
  ])('refuses the whole list when it holds %j', (raw) => {
    expect(parseTrustedProxyCidrs(raw).ok).toBe(false)
  })

  it('names the first unusable entry', () => {
    expect(parseTrustedProxyCidrs('10.0.0.0/8, nope, 172.16.0.0/12')).toEqual({
      ok: false,
      entry: 'nope',
    })
  })
})

describe('isTrustedProxyPeer', () => {
  it('matches peers inside a prefix and refuses those outside', () => {
    expect(isTrustedProxyPeer('10.1.2.3', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxyPeer('11.0.0.1', ['10.0.0.0/8'])).toBe(false)
  })

  it('treats a bare address as a single host', () => {
    expect(isTrustedProxyPeer('192.0.2.7', ['192.0.2.7'])).toBe(true)
    expect(isTrustedProxyPeer('192.0.2.8', ['192.0.2.7'])).toBe(false)
  })

  it('matches across a list', () => {
    expect(isTrustedProxyPeer('172.16.5.5', ['10.0.0.0/8', '172.16.0.0/12'])).toBe(true)
  })

  it('supports IPv6 peers and entries', () => {
    expect(isTrustedProxyPeer('2001:db8::1', ['2001:db8::/32'])).toBe(true)
    expect(isTrustedProxyPeer('2001:db9::1', ['2001:db8::/32'])).toBe(false)
  })

  it('matches an IPv4 peer reported in its IPv6-mapped form against IPv4 entries', () => {
    expect(isTrustedProxyPeer('::ffff:192.0.2.7', ['192.0.2.0/24'])).toBe(true)
    expect(isTrustedProxyPeer('::ffff:198.51.100.7', ['192.0.2.0/24'])).toBe(false)
  })

  it('does not match an IPv6 peer against IPv4 entries', () => {
    expect(isTrustedProxyPeer('2001:db8::1', ['192.0.2.0/24'])).toBe(false)
  })

  it.each(['', 'unknown', 'not-an-ip', '192.0.2.7:443'])('never matches the peer %j', (peer) => {
    expect(isTrustedProxyPeer(peer, ['0.0.0.0/0', '::/0'])).toBe(false)
  })

  it('never matches an empty list', () => {
    expect(isTrustedProxyPeer('10.0.0.1', [])).toBe(false)
  })

  it('skips an unusable entry rather than throwing', () => {
    expect(isTrustedProxyPeer('10.0.0.1', ['bogus', '10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxyPeer('10.0.0.1', ['bogus'])).toBe(false)
  })

  it('never matches a peer carrying an IPv6 zone ID, and never throws on one', () => {
    expect(isTrustedProxyPeer('fe80::1%eth0', ['fe80::/10'])).toBe(false)
  })

  it('answers repeated checks and a changed list from the right list', () => {
    expect(isTrustedProxyPeer('10.0.0.1', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxyPeer('10.0.0.1', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxyPeer('10.0.0.1', ['192.0.2.0/24'])).toBe(false)
    expect(isTrustedProxyPeer('10.0.0.1', ['10.0.0.0/8'])).toBe(true)
  })
})
