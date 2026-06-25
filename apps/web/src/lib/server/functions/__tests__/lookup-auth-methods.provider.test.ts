/**
 * `resolveLoginRouting` — pure per-provider login routing.
 *
 * The email-first login dispatcher routes an email to its owning identity
 * provider when that email is at one of the provider's VERIFIED domains.
 * The contract:
 *   - enforced domain owned by a LIVE provider → `sso-redirect` (no escape)
 *   - verified-but-not-enforced domain owned by a LIVE provider →
 *     `sso-default` (SSO is the default CTA, methods stay as fallback)
 *   - owner disabled / unregistered / no-creds → `methods` (the liveness
 *     gate; an enforced domain whose IdP is dead must fall through to the
 *     methods form, not dead-redirect to a 404 provider)
 *   - unknown domain → `methods`
 *
 * Each carried `providerId` is the owning provider's `registrationId`
 * (Task 14 threads it to the client forms; here we only produce it).
 */
import { describe, it, expect } from 'vitest'
import { resolveLoginRouting } from '../auth-routing'

describe('resolveLoginRouting', () => {
  it('redirects an enforced domain email to its provider', () => {
    const r = resolveLoginRouting('a@acme.com', [
      {
        registrationId: 'sso',
        enabled: true,
        registered: true,
        credsPresent: true,
        domains: [{ name: 'acme.com', verifiedAt: 'x', enforced: true }],
      } as never,
    ])
    expect(r).toEqual({ kind: 'sso-redirect', providerId: 'sso' })
  })

  it('routes a verified-but-not-enforced domain email to sso-default', () => {
    const r = resolveLoginRouting('a@acme.com', [
      {
        registrationId: 'sso',
        enabled: true,
        registered: true,
        credsPresent: true,
        domains: [{ name: 'acme.com', verifiedAt: 'x', enforced: false }],
      } as never,
    ])
    expect(r).toEqual({ kind: 'sso-default', providerId: 'sso' })
  })

  it('falls through to methods when the owning provider is disabled', () => {
    const r = resolveLoginRouting('a@acme.com', [
      {
        registrationId: 'sso',
        enabled: false,
        registered: false,
        credsPresent: true,
        domains: [{ name: 'acme.com', verifiedAt: 'x', enforced: true }],
      } as never,
    ])
    expect(r.kind).toBe('methods')
  })

  it('falls through to methods when the owning provider is not registered (tier/secret drift)', () => {
    const r = resolveLoginRouting('a@acme.com', [
      {
        registrationId: 'sso',
        enabled: true,
        registered: false,
        credsPresent: false,
        domains: [{ name: 'acme.com', verifiedAt: 'x', enforced: true }],
      } as never,
    ])
    expect(r.kind).toBe('methods')
  })

  it('falls through to methods for an unknown domain', () => {
    expect(resolveLoginRouting('a@other.com', []).kind).toBe('methods')
  })

  it('ignores unverified (verifiedAt=null) domains', () => {
    const r = resolveLoginRouting('a@acme.com', [
      {
        registrationId: 'sso',
        enabled: true,
        registered: true,
        credsPresent: true,
        domains: [{ name: 'acme.com', verifiedAt: null, enforced: true }],
      } as never,
    ])
    expect(r.kind).toBe('methods')
  })
})
