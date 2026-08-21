/**
 * Workspace separation of the HKDF-derived encryption keys, and — the part that
 * cannot be got wrong — byte-identity of the single-workspace derivation.
 *
 * Every self-hosted install's integration OAuth tokens, webhook signing secrets
 * and connector secrets are sealed under the historical derivation. If it
 * changes, those values do not "need migrating"; they are gone. So the expected
 * key is hardcoded rather than recomputed from the source's own constants: a
 * test that derives its expectation the same way the code does would follow the
 * code wherever it went.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCipheriv, randomBytes } from 'node:crypto'

const SECRET_KEY = 'test-secret-key-for-encryption-tests'

vi.mock('@/lib/server/config', () => ({
  config: { secretKey: SECRET_KEY },
}))

const { encrypt, decrypt, _resetKeyCache } = await import('../encryption')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

/**
 * hkdf-sha256(SECRET_KEY, salt='quackback-encryption-salt-v1',
 * info='quackback:v1:integration-tokens', 32) — the derivation as it stood
 * before tenancy existed. Pinned, not computed.
 */
const HISTORICAL_KEY_HEX = 'bc648c38680bb360fcd00058eca995b7b7dccc0516dc580584a0d364e3dc09ad'

/** Encrypt with an explicitly supplied key, in the module's wire format. */
function sealWith(keyHex: string, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv, {
    authTagLength: 16,
  })
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.')
}

beforeEach(() => {
  _resetKeyCache()
})

describe('deriveKey under the single-workspace namespace', () => {
  it('is byte-identical to the pre-tenancy derivation', () => {
    // Sealed with the pinned key, opened by the module. Only an identical key
    // passes the GCM auth tag.
    const sealed = sealWith(HISTORICAL_KEY_HEX, 'stored-oauth-refresh-token')

    expect(decrypt(sealed, 'integration-tokens')).toBe('stored-oauth-refresh-token')
  })

  it('still opens what it sealed', () => {
    const sealed = encrypt('webhook-signing-secret', 'webhook-secrets')
    expect(decrypt(sealed, 'webhook-secrets')).toBe('webhook-signing-secret')
  })
})

describe('deriveKey under a workspace scope', () => {
  /**
   * hkdf-sha256(ikm='test-secret-key-for-workspace-alpha-0123456789abcdef',
   * salt='quackback-encryption-salt-v1',
   * info='quackback:v1:t:workspace-alpha:integration-tokens', 32).
   *
   * The IKM is the WORKSPACE's resolved `SECRET_KEY`, not the fleet-wide one. That
   * is the whole point of this case and it is the only one that can see it: every
   * other test here passes whether the master secret is per-workspace or shared,
   * because the info string already carried the workspace. Pinned rather than
   * computed, so it cannot follow the source.
   */
  const WORKSPACE_KEY_HEX = 'f2815cfebf7d0231764fc1feec104cedab2dd2ebef4148b736a6e4139903e27f'

  it('derives from the WORKSPACE’s own SECRET_KEY, not the fleet-wide one', () => {
    const sealed = sealWith(WORKSPACE_KEY_HEX, 'alpha-oauth-refresh-token')

    expect(withWorkspace('workspace-alpha', () => decrypt(sealed, 'integration-tokens'))).toBe(
      'alpha-oauth-refresh-token'
    )
  })

  it('does not derive the single-workspace key', () => {
    const sealedWithHistoricalKey = sealWith(HISTORICAL_KEY_HEX, 'stored-oauth-refresh-token')

    expect(() =>
      withWorkspace('workspace-alpha', () => decrypt(sealedWithHistoricalKey, 'integration-tokens'))
    ).toThrow(/Decryption failed/)
  })

  it('derives a different key per workspace for the same purpose', () => {
    const sealedByAlpha = withWorkspace('workspace-alpha', () =>
      encrypt('alpha-access-token', 'integration-tokens')
    )

    expect(
      withWorkspace('workspace-alpha', () => decrypt(sealedByAlpha, 'integration-tokens'))
    ).toBe('alpha-access-token')
    expect(() =>
      withWorkspace('workspace-bravo', () => decrypt(sealedByAlpha, 'integration-tokens'))
    ).toThrow(/Decryption failed/)
  })

  it('separates in both directions, not just the one the cache happened to fill', () => {
    const sealedByBravo = withWorkspace('workspace-bravo', () =>
      encrypt('bravo-access-token', 'integration-tokens')
    )
    const sealedByAlpha = withWorkspace('workspace-alpha', () =>
      encrypt('alpha-access-token', 'integration-tokens')
    )

    expect(() =>
      withWorkspace('workspace-alpha', () => decrypt(sealedByBravo, 'integration-tokens'))
    ).toThrow(/Decryption failed/)
    expect(() =>
      withWorkspace('workspace-bravo', () => decrypt(sealedByAlpha, 'integration-tokens'))
    ).toThrow(/Decryption failed/)
    // And neither leaked into the unscoped namespace.
    expect(() => decrypt(sealedByAlpha, 'integration-tokens')).toThrow(/Decryption failed/)
  })

  it('keeps purpose separation inside one workspace', () => {
    const sealed = withWorkspace('workspace-alpha', () => encrypt('value', 'integration-tokens'))
    expect(() =>
      withWorkspace('workspace-alpha', () => decrypt(sealed, 'webhook-secrets'))
    ).toThrow(/Decryption failed/)
  })
})
