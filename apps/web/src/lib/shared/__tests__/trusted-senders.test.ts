/**
 * Client-safe validation for trusted-sender entries, shared by the spam
 * filter service (server) and the admin settings UI (client). Pure unit test.
 */
import { describe, it, expect } from 'vitest'
import { normalizeTrustedSenderEntry } from '../trusted-senders'

describe('normalizeTrustedSenderEntry', () => {
  it('trims and lower-cases a full address', () => {
    expect(normalizeTrustedSenderEntry('  Jane@ACME.com ')).toBe('jane@acme.com')
  })

  it('accepts a bare or @-prefixed domain', () => {
    expect(normalizeTrustedSenderEntry('acme.com')).toBe('acme.com')
    expect(normalizeTrustedSenderEntry('@acme.com')).toBe('@acme.com')
  })

  it('rejects implausible entries instead of storing a never-match', () => {
    expect(normalizeTrustedSenderEntry('')).toBeNull()
    expect(normalizeTrustedSenderEntry('   ')).toBeNull()
    expect(normalizeTrustedSenderEntry('not an address')).toBeNull()
    expect(normalizeTrustedSenderEntry('nodot')).toBeNull()
    expect(normalizeTrustedSenderEntry('jane@')).toBeNull()
    expect(normalizeTrustedSenderEntry('@')).toBeNull()
  })

  it('rejects non-strings and over-long entries', () => {
    expect(normalizeTrustedSenderEntry(42)).toBeNull()
    expect(normalizeTrustedSenderEntry(null)).toBeNull()
    expect(normalizeTrustedSenderEntry(`${'a'.repeat(320)}.com`)).toBeNull()
  })
})
