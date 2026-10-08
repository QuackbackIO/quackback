/**
 * "Require SSO" on a verified domain, in front of the email sign-in mint.
 *
 * `requestEmailSignin` mints its magic link through `mintMagicLinkUrl`, which
 * does not run the `hooks.before` chain, and the link is later redeemed at
 * `/magic-link/verify`, which carries its address inside the token where that
 * chain cannot read it. So the hard-binding rule every other email path gets
 * from the hook layer has to be decided here, before anything is minted.
 *
 * The mint is real and the Better-Auth instance it writes through is a
 * recorder, as in the sibling openSignup suite: every "minted nothing" claim
 * is paired with a control that mints, so an empty recorder is evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  createVerificationValue: vi.fn(async (_row: { identifier: string; value: string }) => ({
    id: 'v_1',
  })),
  createVerificationOTP: vi.fn(async () => '123456'),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  listIdentityProviders: vi.fn(),
  getRegisteredOidcProviderIds: vi.fn(),
}))

vi.mock('../index', () => ({
  getAuth: vi.fn(async () => ({
    api: { createVerificationOTP: hoisted.createVerificationOTP },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: vi.fn(async () => null) },
      // An existing account: the openSignup gate lets it through, so anything
      // that stops the mint below is the rule under test.
      user: { findFirst: vi.fn(async () => ({ id: 'user_1' })) },
      invitation: { findFirst: vi.fn(async () => null) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({ authConfig: { openSignup: true } })),
}))

// Nobody has claimed setup by creating an account; that claim is covered
// against real Postgres.
vi.mock('@/lib/server/domains/principals/bootstrap-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/bootstrap-admin')>()),
  findSetupClaimant: async () => undefined,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: (...a: unknown[]) => hoisted.listIdentityProviders(...a),
}))

vi.mock('../registered-providers', () => ({
  getRegisteredOidcProviderIds: (...a: unknown[]) => hoisted.getRegisteredOidcProviderIds(...a),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: hoisted.sendSignupNotAllowedEmail,
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))

import { requestEmailSignin, EmailSigninRefusedError } from '../email-signin'

function provider(domain: { name: string; enforced: boolean }) {
  return {
    id: 'idp_acme',
    registrationId: 'oidc_acme',
    showButton: true,
    domains: [{ name: domain.name, enforced: domain.enforced, verifiedAt: '2026-01-01T00:00:00Z' }],
  }
}

function mintedFor(): string[] {
  return hoisted.createVerificationValue.mock.calls.map(
    ([row]) => (JSON.parse(row.value) as { email: string }).email
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.listIdentityProviders.mockResolvedValue([provider({ name: 'acme.com', enforced: true })])
  hoisted.getRegisteredOidcProviderIds.mockResolvedValue(new Set(['oidc_acme']))
})

describe('requestEmailSignin: Require SSO', () => {
  it('refuses an address at a domain that requires SSO, and mints nothing', async () => {
    const attempt = requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/admin' })

    await expect(attempt).rejects.toBeInstanceOf(EmailSigninRefusedError)
    await expect(attempt).rejects.toMatchObject({ code: 'verified_domain_requires_sso' })
    expect(mintedFor()).toEqual([])
    expect(hoisted.createVerificationOTP).not.toHaveBeenCalled()
    expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('mints for an address at another domain', async () => {
    await requestEmailSignin({ email: 'sam@example.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@example.com'])
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('mints when the domain is verified but SSO is not required', async () => {
    hoisted.listIdentityProviders.mockResolvedValue([
      provider({ name: 'acme.com', enforced: false }),
    ])

    await requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@acme.com'])
  })

  // Same fail-open as every other path: an owning provider that cannot sign
  // anyone in right now (tier downgrade, missing secret) must not lock the
  // domain out of the workspace entirely.
  it('mints when the owning provider is not registered right now', async () => {
    hoisted.getRegisteredOidcProviderIds.mockResolvedValue(new Set())

    await requestEmailSignin({ email: 'sam@acme.com', callbackURL: '/' })

    expect(mintedFor()).toEqual(['sam@acme.com'])
  })
})
