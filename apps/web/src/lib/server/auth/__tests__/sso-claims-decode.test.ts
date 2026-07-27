import { describe, it, expect } from 'vitest'
import { decodeSsoClaims } from '../sso-claims-decode'

/** Unsigned JWT with the given payload. Signature is never checked here. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const NOW = 1_800_000_000_000 // fixed ms epoch

describe('decodeSsoClaims', () => {
  it('returns the payload for a live token', () => {
    const token = jwt({ sub: 'u1', groups: ['admins'], exp: NOW / 1000 + 3600 })
    expect(decodeSsoClaims(token, NOW)).toMatchObject({ sub: 'u1', groups: ['admins'] })
  })

  it('returns nothing for an absent token', () => {
    expect(decodeSsoClaims(null, NOW)).toEqual({})
    expect(decodeSsoClaims('', NOW)).toEqual({})
  })

  it('returns nothing for a malformed token', () => {
    expect(decodeSsoClaims('not-a-jwt', NOW)).toEqual({})
    expect(decodeSsoClaims('a.b', NOW)).toEqual({})
    expect(decodeSsoClaims('a.!!!not-base64!!!.c', NOW)).toEqual({})
  })

  it('REFUSES an expired token', () => {
    // The escalation this closes: the stored id_token is never cleared and the
    // refresh path filters undefined out of the account update, so once an IdP
    // stops issuing one the last token persists. With sync-on-every-sign-in,
    // that would keep re-applying a role from a token issued months ago, and
    // revoking the group upstream would never demote anyone.
    const stale = jwt({ sub: 'u1', groups: ['admins'], exp: NOW / 1000 - 1 })
    expect(decodeSsoClaims(stale, NOW)).toEqual({})
  })

  it('treats an exp exactly at now as expired', () => {
    expect(decodeSsoClaims(jwt({ sub: 'u1', exp: NOW / 1000 }), NOW)).toEqual({})
  })

  it('accepts a token with no exp claim', () => {
    // Non-conformant but real. Falling back to the default role for these would
    // be a behaviour regression for setups that work today, and the attack this
    // guards against needs a token that IS dated and stale.
    expect(decodeSsoClaims(jwt({ sub: 'u1', groups: ['x'] }), NOW)).toMatchObject({ sub: 'u1' })
  })

  it('ignores a non-numeric exp rather than trusting it', () => {
    expect(decodeSsoClaims(jwt({ sub: 'u1', exp: 'soon' }), NOW)).toMatchObject({ sub: 'u1' })
  })

  it('returns nothing when the payload is not an object', () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    expect(decodeSsoClaims(`${b64({})}.${b64('a string')}.sig`, NOW)).toEqual({})
    expect(decodeSsoClaims(`${b64({})}.${b64(null)}.sig`, NOW)).toEqual({})
  })
})
