/**
 * The guard proxy judges addresses by the app's own SSRF rules (safeFetch's
 * `checkUrlSafety`): loopback, private, link-local, metadata and internal
 * names are refused. Literal addresses only, so no lookup leaves the machine.
 */
import { describe, expect, it } from 'vitest'
import { allowedAddress } from '../guard-proxy'

describe('allowedAddress, with the app’s SSRF rules', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('refuses %s', async (host) => {
    expect(await allowedAddress(host, 443)).toBeNull()
  })

  it('refuses internal names before resolving them', async () => {
    for (const host of ['localhost', 'metadata.google.internal', 'nas.lan', 'printer.local'])
      expect(await allowedAddress(host, 443)).toBeNull()
  })

  it('allows a public address on the secure port only', async () => {
    expect(await allowedAddress('93.184.215.14', 443)).toEqual({
      address: '93.184.215.14',
      family: 4,
    })
    expect(await allowedAddress('93.184.215.14', 80)).toBeNull()
  })
})
