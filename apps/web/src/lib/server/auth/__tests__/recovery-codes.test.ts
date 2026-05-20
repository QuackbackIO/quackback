/**
 * Tests for the SSO recovery-code helpers.
 *
 *  - generateRecoveryCode emits the XXXX-XXXX-XXXX Crockford-base32 shape
 *    with sufficient entropy (60 bits)
 *  - hashRecoveryCode produces salted scrypt digests in `{salt}:{key}` hex
 *  - verifyRecoveryCode is constant-time, accepts user-formatting
 *    (lowercase, with/without dashes), and rejects mismatches
 */
import { describe, it, expect } from 'vitest'
import {
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
} from '../recovery-codes'

describe('generateRecoveryCode', () => {
  it('produces a XXXX-XXXX-XXXX Crockford base32 shape', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('uses Crockford characters only (no 0/O ambiguity, no I/L/U)', () => {
    const stripped = generateRecoveryCode().replace(/-/g, '')
    for (const c of stripped) {
      expect(RECOVERY_CODE_ALPHABET).toContain(c)
    }
  })

  it('produces unique codes across many calls (entropy sanity)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()))
    expect(codes.size).toBe(200)
  })
})

describe('normalizeRecoveryCode', () => {
  it('uppercases and strips dashes / whitespace', () => {
    expect(normalizeRecoveryCode('abcd-efgh-ijkl')).toBe('ABCDEFGHIJKL')
    expect(normalizeRecoveryCode('  AbCd EfGh IjKl  ')).toBe('ABCDEFGHIJKL')
  })
})

describe('hashRecoveryCode / verifyRecoveryCode', () => {
  it('round-trips the same code', async () => {
    const code = 'ABCD-EFGH-JKMN'
    const hash = await hashRecoveryCode(code)
    expect(await verifyRecoveryCode(code, hash)).toBe(true)
  })

  it('accepts the same code in different presentations (case / dashes)', async () => {
    const hash = await hashRecoveryCode('ABCD-EFGH-JKMN')
    expect(await verifyRecoveryCode('abcdefghjkmn', hash)).toBe(true)
    expect(await verifyRecoveryCode('  ABCD-efgh-JKMN  ', hash)).toBe(true)
  })

  it('rejects a different code', async () => {
    const hash = await hashRecoveryCode('ABCD-EFGH-JKMN')
    expect(await verifyRecoveryCode('ZZZZ-ZZZZ-ZZZZ', hash)).toBe(false)
  })

  it('rejects a malformed hash without throwing', async () => {
    expect(await verifyRecoveryCode('ABCD', 'not-a-real-hash')).toBe(false)
    expect(await verifyRecoveryCode('ABCD', '')).toBe(false)
  })

  it('uses fresh salts so the same code hashes to two different digests', async () => {
    const a = await hashRecoveryCode('ABCD-EFGH-JKMN')
    const b = await hashRecoveryCode('ABCD-EFGH-JKMN')
    expect(a).not.toBe(b)
    // But both still verify.
    expect(await verifyRecoveryCode('ABCD-EFGH-JKMN', a)).toBe(true)
    expect(await verifyRecoveryCode('ABCD-EFGH-JKMN', b)).toBe(true)
  })

  it('produces a hash in `{salt_hex}:{key_hex}` shape (matches better-auth scrypt format)', async () => {
    const hash = await hashRecoveryCode('ABCD-EFGH-JKMN')
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
  })
})
