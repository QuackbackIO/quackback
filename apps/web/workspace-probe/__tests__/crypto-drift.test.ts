/**
 * Drift pins for the two tokens the harness has to mint for itself.
 *
 * `crypto.ts` re-implements schemes whose production originals are module-private
 * (`storageReadSig` in `lib/server/storage/s3.ts`) or live behind a different
 * import boundary. If the server changes its construction and the harness does
 * not, every cross-workspace attempt is refused because the token is malformed —
 * a false PASS on the exact probe that was supposed to be watching.
 *
 * These tests assert the minted token against the REAL verifier, so drift breaks
 * `bun run test` rather than silently weakening a probe.
 */

import { describe, expect, it } from 'vitest'
import { verifyStorageReadToken } from '@/lib/server/storage/s3'
import { mintStorageReadSig, mintWidgetIdentityToken } from '../crypto'

describe('storage read capability', () => {
  const secret = 'a-workspace-storage-secret'
  const key = 'uploads/2026/08/some-object.bin'

  it('mints a signature the production verifier accepts', () => {
    expect(verifyStorageReadToken(secret, key, mintStorageReadSig(secret, key))).toBe(true)
  })

  it('is rejected under a different secret — the whole basis of P03', () => {
    const otherWorkspaceSig = mintStorageReadSig('a-different-workspace-secret', key)
    expect(verifyStorageReadToken(secret, key, otherWorkspaceSig)).toBe(false)
  })

  it('is bound to the key, so P03 must hold the key constant across workspaces', () => {
    const sig = mintStorageReadSig(secret, key)
    expect(verifyStorageReadToken(secret, 'uploads/2026/08/another-object.bin', sig)).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifyStorageReadToken(secret, key, null)).toBe(false)
  })
})

describe('widget identify token', () => {
  it('produces a three-part HS256 JWT with the claims the identify route requires', () => {
    const token = mintWidgetIdentityToken('wgt_secret', {
      sub: 'visitor-1',
      email: 'probe-visitor@example.com',
    })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    expect(payload.sub).toBe('visitor-1')
    expect(payload.email).toBe('probe-visitor@example.com')
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })

  it('produces different signatures under different secrets', () => {
    const claims = { sub: 'visitor-1', email: 'probe-visitor@example.com' }
    const a = mintWidgetIdentityToken('wgt_alpha', claims).split('.')[2]
    const b = mintWidgetIdentityToken('wgt_bravo', claims).split('.')[2]
    expect(a).not.toBe(b)
  })

  it('emits base64url with no padding, as the JWT spec requires', () => {
    const token = mintWidgetIdentityToken('wgt_secret', { sub: 'a'.repeat(10), email: 'x@y.test' })
    expect(token).not.toContain('=')
    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
  })
})
