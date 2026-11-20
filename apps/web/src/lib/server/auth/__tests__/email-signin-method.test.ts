/**
 * The "Email magic link" sign-in method, in front of the email sign-in mint.
 *
 * `requestEmailSignin` mints a link and a code without running the
 * `hooks.before` chain, so the method toggle that chain enforces for every
 * other email path has to be decided here. With the method off it used to mail
 * a working link and code all the same.
 *
 * Two ways in survive the method being off:
 *  - email links stand in while identity providers are set up but single
 *    sign-on is paused (`effectiveSignInMethods`), and
 *  - the link-conflict confirmation: an existing account proving its address
 *    so a provider sign-in can be linked to it (`/auth/link-sso`).
 *
 * The mint is real and the Better-Auth instance it writes through is a
 * recorder: every "minted nothing" claim is paired with a control that mints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  createVerificationValue: vi.fn(async (_row: { identifier: string; value: string }) => ({
    id: 'v_1',
  })),
  createVerificationOTP: vi.fn(async () => '123456'),
  sendMagicLinkEmail: vi.fn(async (_args: { signInUrl: string }) => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  userFindFirst: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  registered: new Set<string>(),
  sso: { ssoLive: true, providersConfigured: false },
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
      user: { findFirst: (...a: unknown[]) => hoisted.userFindFirst(...a) },
      invitation: { findFirst: vi.fn(async () => null) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: (...a: unknown[]) => hoisted.getWorkspaceSettings(...a),
}))

// Nobody has claimed setup by creating an account; that claim is covered
// against real Postgres.
vi.mock('@/lib/server/domains/principals/bootstrap-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/bootstrap-admin')>()),
  findSetupClaimant: async () => undefined,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => [],
}))

vi.mock('../registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => hoisted.registered,
  getSsoSignInState: async () => hoisted.sso,
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: hoisted.sendSignupNotAllowedEmail,
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))

import { requestEmailSignin, EmailSigninRefusedError } from '../email-signin'
import { isEmailSigninToken } from '../magic-link-mint'

const EMAIL = 'sam@example.com'
const LINK_SSO = '/auth/link-sso?provider=oidc_acme&type=oidc&next=%2Froadmap'

function linksMinted(): string[] {
  return hoisted.createVerificationValue.mock.calls
    .map(([row]) => row.identifier)
    .filter((id) => id.startsWith('magic-link:'))
}

function mintedTokens(): string[] {
  return linksMinted().map((id) => id.slice('magic-link:'.length))
}

function nothingSent(): void {
  expect(linksMinted()).toEqual([])
  expect(hoisted.createVerificationOTP).not.toHaveBeenCalled()
  expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
  expect(hoisted.sendSignupNotAllowedEmail).not.toHaveBeenCalled()
}

function methodOn(on: boolean) {
  hoisted.getWorkspaceSettings.mockResolvedValue({
    authConfig: { openSignup: true, oauth: { password: true, magicLink: on } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.userFindFirst.mockResolvedValue({ id: 'user_1' })
  hoisted.registered = new Set(['oidc_acme'])
  hoisted.sso = { ssoLive: true, providersConfigured: false }
  methodOn(false)
})

describe('requestEmailSignin: the Email magic link method', () => {
  it('refuses while the method is off, and mints and mails nothing', async () => {
    const attempt = requestEmailSignin({ email: EMAIL, callbackURL: '/roadmap' })

    await expect(attempt).rejects.toBeInstanceOf(EmailSigninRefusedError)
    await expect(attempt).rejects.toMatchObject({ code: 'magic_link_method_not_allowed' })
    nothingSent()
  })

  // The refusal is the workspace's, so it must be the same for every address.
  it('refuses an address with no account in exactly the same way', async () => {
    hoisted.userFindFirst.mockResolvedValue(null)

    await expect(
      requestEmailSignin({ email: 'nobody@example.com', callbackURL: '/roadmap' })
    ).rejects.toMatchObject({ code: 'magic_link_method_not_allowed' })
    nothingSent()
  })

  it('mints and mails while the method is on (the control)', async () => {
    methodOn(true)

    await requestEmailSignin({ email: EMAIL, callbackURL: '/roadmap' })

    expect(linksMinted()).toHaveLength(1)
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })

  // The verify side reads the token's mark: a link the method governs is one
  // whose redemption the method can still refuse after it is mailed.
  it('marks the link it mints as an email sign-in link', async () => {
    methodOn(true)

    await requestEmailSignin({ email: EMAIL, callbackURL: '/roadmap' })

    expect(mintedTokens().map(isEmailSigninToken)).toEqual([true])
  })

  it('mints while email links stand in for single sign-on that is paused', async () => {
    hoisted.sso = { ssoLive: false, providersConfigured: true }

    await requestEmailSignin({ email: EMAIL, callbackURL: '/roadmap' })

    expect(linksMinted()).toHaveLength(1)
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })
})

describe('requestEmailSignin: the link-conflict confirmation while the method is off', () => {
  // Nothing on the server records that a provider sign-in hit
  // `account_not_linked` for an address, so a callback naming `/auth/link-sso`
  // is only the caller's word. It is refused like any other email, the same
  // way for an address with an account and one without.
  it.each([
    ['an existing account', { id: 'user_1' }],
    ['no account', null],
  ])('refuses it for %s, and mints and mails nothing', async (_label, account) => {
    hoisted.userFindFirst.mockResolvedValue(account)

    await expect(requestEmailSignin({ email: EMAIL, callbackURL: LINK_SSO })).rejects.toMatchObject(
      { code: 'magic_link_method_not_allowed' }
    )
    nothingSent()
  })

  it('sends it while the method is on (the control)', async () => {
    methodOn(true)

    await requestEmailSignin({ email: EMAIL, callbackURL: LINK_SSO })

    expect(linksMinted()).toHaveLength(1)
    const url = new URL(hoisted.sendMagicLinkEmail.mock.calls[0]![0].signInUrl)
    expect(url.searchParams.get('callbackURL')).toBe(`https://acme.quackback.io${LINK_SSO}`)
  })
})
