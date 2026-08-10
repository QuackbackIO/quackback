/**
 * What the SECRET_KEY canary actually proves, versus what it is relied on to prove.
 *
 * `fleet-secrets.ts` and `fingerprint.ts` both state the canary's purpose in the
 * same words: it verifies that "the key this process is about to encrypt with is
 * the key this database's existing ciphertext was written under". `pool-cache.ts`
 * runs it once per pool on that basis, and `request-scope.ts` routes its failure
 * codes through `isKeyCustodyFailureCode` so a key problem never pulls the
 * cross-tenant alarm.
 *
 * The canary cannot answer that question. It is a constant, sealed by whichever
 * party most recently took custody, and it says only "this process holds the key
 * the canary was sealed with". Nothing ties it to the ciphertext already sitting
 * in the database, so a custody change that stamps a fresh canary certifies the
 * new key over stored data the new key cannot open.
 *
 * That is not hypothetical. It is the state `inst_gauntlet_neon_t2` was in on
 * 2026-08-09:
 *
 * | 12:21 | registry row created, no canary, no custody established |
 * | 14:20 | better-auth mints the tenant's JWKS, encrypted under the key then in force |
 * | 14:32 | custody moves to a per-tenant key; a fresh canary is stamped under it |
 * | after | pool checkout passes the canary, the tenant serves, and every |
 * |       | authenticated request 500s on a JWKS the resolved key cannot decrypt |
 *
 * The canary was absent at 14:32, and an absent canary is treated as greenfield
 * by the writer (`quackback-cp` `stampSecretKeyCanary` only refuses a canary that
 * is *present* and unopenable). But absent does not mean "nothing to protect", it
 * means "no record of which key this database's ciphertext was written under",
 * and the database held an obvious sample either way.
 *
 * These tests pin the gap. The first two describe what the canary does do and
 * pass today. The third asserts the property the callers rely on and is RED: the
 * verdict says `ok` for a key that cannot open the tenant's own stored ciphertext.
 *
 * Closing it needs the verdict to see a real sample rather than a minted
 * constant, which is a change to what `observeTenantIdentity` reads and to the
 * `IdentityFailure` union, not a tweak to this predicate. Left red deliberately
 * so the gap is a failing test rather than a paragraph.
 */
import { describe, expect, it } from 'vitest'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { evaluateSecretKeyCanary } from '../fingerprint'
import { sealSecretKeyCanary } from '../vendor/fleet-secrets'

const TENANT = 'inst_gauntlet_neon_t2'

/**
 * The key in force when the tenant's stored ciphertext was written, and the key
 * the fleet resolves for it now. Two independent 32-byte values, exactly as a
 * move from a fleet-wide `SECRET_KEY` to a per-tenant one produces.
 */
const KEY_AT_WRITE_TIME = 'a'.repeat(64)
const KEY_AFTER_CUSTODY_CHANGE = 'b'.repeat(64)

/**
 * `encryption.ts`'s scheme, reproduced at its own boundary: HKDF-SHA256 from the
 * master secret, then AES-256-GCM. Reproduced rather than imported because the
 * point here is the key, not the module, and importing it would drag in
 * `config` and the tenant-keyed cache for no gain.
 */
function sealStoredValue(masterSecret: string, plaintext: string): string {
  const key = Buffer.from(
    hkdfSync('sha256', masterSecret, 'quackback-encryption-salt-v1', 'quackback:v1:probe', 32)
  )
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.')
}

function opensStoredValue(masterSecret: string, ciphertext: string): boolean {
  const [ivB64, tagB64, bodyB64] = ciphertext.split('.')
  const key = Buffer.from(
    hkdfSync('sha256', masterSecret, 'quackback-encryption-salt-v1', 'quackback:v1:probe', 32)
  )
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64url'), {
      authTagLength: 16,
    })
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'))
    Buffer.concat([decipher.update(Buffer.from(bodyB64!, 'base64url')), decipher.final()])
    return true
  } catch {
    return false
  }
}

describe('the SECRET_KEY canary, on its own terms', () => {
  it('refuses a key that does not open the stamped canary', () => {
    const canary = sealSecretKeyCanary(KEY_AT_WRITE_TIME, TENANT)
    const verdict = evaluateSecretKeyCanary(TENANT, KEY_AFTER_CUSTODY_CHANGE, canary)
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'secret_key_canary_mismatch' })
  })

  it('refuses when no canary was ever stamped, rather than passing on no evidence', () => {
    const verdict = evaluateSecretKeyCanary(TENANT, KEY_AFTER_CUSTODY_CHANGE, null)
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'secret_key_canary_missing' })
  })
})

describe('the SECRET_KEY canary, on the terms its callers rely on', () => {
  it('refuses a key that opens the canary but not the tenant’s stored ciphertext', () => {
    // 14:20 — better-auth writes the tenant's JWKS under the key then in force.
    const storedCiphertext = sealStoredValue(KEY_AT_WRITE_TIME, '{"kty":"OKP","crv":"Ed25519"}')

    // 14:32 — custody moves. A fresh canary is stamped under the new key over a
    // database whose ciphertext nobody re-encrypted.
    const canary = sealSecretKeyCanary(KEY_AFTER_CUSTODY_CHANGE, TENANT)

    // The database is genuinely stale: this is the fact the verdict is supposed
    // to be reporting, established independently so the assertion below cannot
    // pass for the wrong reason.
    expect(opensStoredValue(KEY_AFTER_CUSTODY_CHANGE, storedCiphertext)).toBe(false)
    expect(opensStoredValue(KEY_AT_WRITE_TIME, storedCiphertext)).toBe(true)

    // RED. Serving this tenant writes new ciphertext under a key that cannot
    // read the old, which is the exact outcome the canary is documented to
    // prevent, and every authenticated request 500s on the stale value.
    const verdict = evaluateSecretKeyCanary(TENANT, KEY_AFTER_CUSTODY_CHANGE, canary)
    expect(verdict.ok).toBe(false)
  })
})
