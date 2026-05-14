/**
 * isHardBound — policy predicate for per-verified-domain SSO enforcement.
 *
 *  - Fires when the candidate email matches a verified-domain row whose
 *    `enforced=true` flag is set.
 *  - Provider gate: every provider except `sso` is subject to hard-
 *    binding (SSO *is* the enforced method). OAuth-callback paths are
 *    gated in Layer C (`handleCallbackPolicyCleanup`); Layer B handles
 *    password / magic-link pre-session.
 *  - Master switch `ssoOidc.enabled=false` disables enforcement
 *    indirectly via `isSsoActuallyRegistered`.
 *  - Runtime fail-open: callers pass `ssoActuallyRegistered`; when
 *    false (tier downgrade, missing secret) the branch is dormant to
 *    prevent self-lockout.
 */
import { describe, it, expect } from 'vitest'
import { isHardBound, isSsoConfigured, type AuthProvider } from '../auth-restrictions'
import type { AuthConfig, VerifiedDomain } from '@/lib/server/domains/settings/settings.types'

const baseConfig: AuthConfig = {
  oauth: { password: true },
  openSignup: false,
}

const baseSso = {
  enabled: true,
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  clientId: 'cid',
  autoCreateUsers: false,
} as const

// `as never` rather than `as AuthConfig['ssoOidc']` because some regression
// tests pass legacy fields (e.g. `required`) that may be removed from the
// AuthConfig type in a follow-up. The cast keeps the assertion alive even
// after the type narrows; the predicate's behaviour is what we're testing,
// not the type shape.
const configWithSso = (overrides: Record<string, unknown> = {}): AuthConfig => ({
  ...baseConfig,
  ssoOidc: { ...baseSso, ...overrides } as never,
})

const enforcedDomain: VerifiedDomain = {
  id: 'domain_acme' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-05-01T00:00:00.000Z',
  enforced: true,
  createdAt: '2026-05-01T00:00:00.000Z',
}

const verifiedDomain: VerifiedDomain = { ...enforcedDomain, enforced: false }

const callIsHardBound = (
  provider: AuthProvider | string,
  email: string | null | undefined,
  role: 'admin' | 'member' | 'user',
  authConfig: AuthConfig | undefined,
  verifiedDomains: readonly VerifiedDomain[] | undefined,
  ssoRegistered = true
) => isHardBound(provider, email, role, authConfig, verifiedDomains, ssoRegistered)

describe('isSsoConfigured — master-switch helper', () => {
  it('returns true when ssoOidc.enabled === true', () => {
    expect(isSsoConfigured(baseSso)).toBe(true)
  })

  it('returns false when ssoOidc.enabled === false', () => {
    expect(isSsoConfigured({ ...baseSso, enabled: false })).toBe(false)
  })

  it('returns false when ssoOidc is undefined (never configured)', () => {
    expect(isSsoConfigured(undefined)).toBe(false)
  })
})

describe('isHardBound — per-verified-domain branch', () => {
  it('blocks credential at an enforced verified domain', () => {
    expect(
      callIsHardBound('credential', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('blocks magic-link at an enforced verified domain', () => {
    expect(
      callIsHardBound('magic-link', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('does NOT block when verified domain has enforced=false', () => {
    expect(
      callIsHardBound('credential', 'a@acme.com', 'admin', configWithSso(), [verifiedDomain])
    ).toBe(false)
  })

  it('does NOT block emails at a different domain', () => {
    expect(
      callIsHardBound('credential', 'a@example.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(false)
  })

  it('blocks portal users at an enforced verified domain (email-driven, not role-driven)', () => {
    expect(
      callIsHardBound('credential', 'a@acme.com', 'user', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })
})

describe('isHardBound — provider gate (only `sso` is exempt)', () => {
  it('returns false for sso — SSO *is* the enforced method', () => {
    expect(callIsHardBound('sso', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])).toBe(
      false
    )
  })

  it('blocks google at an enforced verified domain', () => {
    expect(
      callIsHardBound('google', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('blocks github at an enforced verified domain', () => {
    expect(
      callIsHardBound('github', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('blocks a generic OAuth provider id at an enforced verified domain', () => {
    expect(
      callIsHardBound('okta-custom', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain])
    ).toBe(true)
  })

  it('blocks social OAuth for a portal user too (email-driven, not role-driven)', () => {
    expect(callIsHardBound('google', 'a@acme.com', 'user', configWithSso(), [enforcedDomain])).toBe(
      true
    )
  })

  it('does NOT block social OAuth when the domain is not enforced', () => {
    expect(
      callIsHardBound('google', 'a@acme.com', 'admin', configWithSso(), [verifiedDomain])
    ).toBe(false)
  })

  it('fails open for social OAuth when SSO is not actually registered', () => {
    expect(
      callIsHardBound('google', 'a@acme.com', 'admin', configWithSso(), [enforcedDomain], false)
    ).toBe(false)
  })
})

describe('isHardBound — runtime fail-open (ssoActuallyRegistered=false)', () => {
  it('fails open even with an enforced verified-domain row', () => {
    expect(
      callIsHardBound(
        'credential',
        'a@acme.com',
        'admin',
        configWithSso(),
        [enforcedDomain],
        /* ssoRegistered */ false
      )
    ).toBe(false)
  })

  it('fails open for magic-link too', () => {
    expect(
      callIsHardBound(
        'magic-link',
        'a@acme.com',
        'admin',
        configWithSso(),
        [enforcedDomain],
        /* ssoRegistered */ false
      )
    ).toBe(false)
  })

  it('still blocks when registered=true and policy says so (regression: param does not invert)', () => {
    expect(
      callIsHardBound(
        'credential',
        'a@acme.com',
        'admin',
        configWithSso(),
        [enforcedDomain],
        /* ssoRegistered */ true
      )
    ).toBe(true)
  })
})

describe('isHardBound — master switch (ssoOidc.enabled)', () => {
  it('returns false when ssoOidc is absent (never configured) and registered=false', () => {
    expect(
      callIsHardBound(
        'credential',
        'a@acme.com',
        'admin',
        baseConfig,
        [enforcedDomain],
        /* ssoRegistered */ false
      )
    ).toBe(false)
  })

  it('returns false when ssoOidc.enabled=false and registered=false (stale enforced row)', () => {
    expect(
      callIsHardBound(
        'credential',
        'a@acme.com',
        'admin',
        configWithSso({ enabled: false }),
        [enforcedDomain],
        /* ssoRegistered */ false
      )
    ).toBe(false)
  })
})

describe('isHardBound — ignores legacy ssoOidc.required flag (regression guard)', () => {
  // Workspace-wide enforcement was removed in favour of per-verified-domain
  // enforcement only. The `required` flag on the stored authConfig is inert
  // — if a stale row still has it, the predicate must NOT block on it.
  it('returns false for credential when required=true and no enforced domain matches', () => {
    expect(
      callIsHardBound(
        'credential',
        'foo@example.com',
        'admin',
        configWithSso({ required: true }),
        []
      )
    ).toBe(false)
  })

  it('returns false for magic-link when required=true and no enforced domain matches', () => {
    expect(
      callIsHardBound(
        'magic-link',
        'foo@example.com',
        'member',
        configWithSso({ required: true }),
        []
      )
    ).toBe(false)
  })
})
