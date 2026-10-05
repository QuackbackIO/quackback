import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockMintMagicLinkUrl: vi.fn(async (opts: { email: string }) => ({
    url: 'https://example.com/verify-magic-link?token=t',
    token: 't',
    // The address written into the verification row. Senders mail this rather
    // than the request string, so the mock has to carry it.
    sealedAddress: opts.email,
  })),
  // The path-less mint returns the code to its caller rather than routing it
  // through the plugin's send callback, so the double returns one too.
  mockCreateVerificationOTP: vi.fn(async () => '123456'),
  mockSendMagicLinkEmail: vi.fn(async () => undefined),
  settings: null as null | { name: string; logoKey: string | null },
}))

vi.mock('../magic-link-mint', () => ({ mintMagicLinkUrl: hoisted.mockMintMagicLinkUrl }))

// This suite is about which failed-verify URL the mint is asked for, so the
// signup gate in front of it is opened rather than exercised. Spread the real
// module so `SignupNotAllowedError` stays the real class for anyone catching it.
// `email-signin-signup-gate.test.ts` drives the gate for real, against the real
// mint — a mocked mint cannot see the row it writes.
vi.mock('../signup-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../signup-policy')>()),
  isAccountCreationAllowed: vi.fn(async () => true),
}))

vi.mock('../index', () => ({
  getAuth: vi.fn(async () => ({
    api: { createVerificationOTP: hoisted.mockCreateVerificationOTP },
  })),
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: vi.fn(async () => hoisted.settings) } } },
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.mockSendMagicLinkEmail,
  // Present so the module destructure resolves; this suite opens the gate, so
  // the refusal branch is never taken and this is never called.
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))

vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))

import { requestEmailSignin } from '../email-signin'

describe('requestEmailSignin — failed-verify redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes admin callbacks to the unified login on failed verify, keeping the deep link', async () => {
    await requestEmailSignin({
      email: 'jess@example.com',
      callbackURL: '/admin/status?view=components',
    })
    expect(hoisted.mockMintMagicLinkUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackPath: '/admin/status?view=components',
        errorCallbackPath: '/auth/login?callbackUrl=%2Fadmin%2Fstatus%3Fview%3Dcomponents',
      })
    )
  })

  // The link lands on `${origin}${callbackPath}`: "@evil.example" would make
  // the origin a userinfo prefix and ".evil.example" a subdomain of another host.
  it.each([
    ['userinfo', '@evil.example/x'],
    ['host suffix', '.evil.example/x'],
    ['absolute URL', 'https://evil.example/x'],
    ['protocol-relative', '//evil.example/x'],
    ['tab smuggled', '/\t/evil.example/x'],
  ])('signs in to the portal root when the callback is a %s', async (_label, callbackURL) => {
    await requestEmailSignin({ email: 'jess@example.com', callbackURL })
    expect(hoisted.mockMintMagicLinkUrl).toHaveBeenCalledWith(
      expect.objectContaining({ callbackPath: '/', errorCallbackPath: '/auth/login' })
    )
  })

  it('routes portal callbacks to /auth/login on failed verify', async () => {
    await requestEmailSignin({ email: 'user@example.com', callbackURL: '/p/posts' })
    expect(hoisted.mockMintMagicLinkUrl).toHaveBeenCalledWith(
      expect.objectContaining({ errorCallbackPath: '/auth/login' })
    )
  })
})

describe('requestEmailSignin: the sign-in email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the workspace being signed in to, for the subject', async () => {
    hoisted.settings = { name: 'Acme', logoKey: null }
    await requestEmailSignin({ email: 'jess@example.com', callbackURL: '/' })
    hoisted.settings = null
    expect(hoisted.mockSendMagicLinkEmail).toHaveBeenCalledWith(
      expect.objectContaining({ code: '123456', workspaceName: 'Acme' })
    )
  })
})
