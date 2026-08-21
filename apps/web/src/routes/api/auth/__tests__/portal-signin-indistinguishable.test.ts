/**
 * `POST /api/auth/portal-signin` is an unauthenticated endpoint that takes an
 * arbitrary email address and consults a private fact about it. Two things have
 * to be true of it, and both were false:
 *
 *  1. **The answer must not vary with the address.** A workspace that has closed
 *     sign-ups exempts an address a `user` row holds and an address a pending
 *     invitation names. If those two worlds answered differently, anyone could
 *     read out which addresses hold accounts here, and which have been invited
 *     and not yet joined, with no session and no cost.
 *  2. **Asking must cost something.** The limiter that bounds this question on
 *     the Better-Auth endpoints sits behind `sendVerificationOTP`, which a
 *     refusal never reaches, so the refusing branch was free to repeat.
 *
 * These are written as a differential: the same handler, the same workspace,
 * the same request shape, one fact different. Every assertion compares the two
 * worlds to each other rather than to a literal, because a literal cannot tell
 * "both answer 200" from "both are broken in the same way".
 *
 * The control that keeps this honest is `sees the two worlds as different`: it
 * proves the policy really did decide differently underneath. Without it, an
 * accidentally-inert gate would satisfy every equality assertion here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  settingsFindFirst: vi.fn(async () => ({ name: 'Acme', logoKey: null })),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  createVerificationOTP: vi.fn(async () => '123456'),
  createVerificationValue: vi.fn(async () => ({ id: 'v_1' })),
  rateLimitCalls: [] as Array<{ ip: string; email: string }>,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: () => hoisted.settingsFindFirst() },
      user: { findFirst: (...a: unknown[]) => hoisted.userFindFirst(...a) },
      invitation: { findFirst: (...a: unknown[]) => hoisted.invitationFindFirst(...a) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: (...a: unknown[]) => hoisted.findHumanAdmin(...a),
  isOpenToBootstrapClaim: (...a: unknown[]) => hoisted.isOpenToBootstrapClaim(...a),
}))

vi.mock('@/lib/server/auth/index', () => ({
  getAuth: vi.fn(async () => ({
    api: { createVerificationOTP: hoisted.createVerificationOTP },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: hoisted.sendSignupNotAllowedEmail,
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.quackback.io', trustedProxyHops: 1 },
}))

// The limiter records what it was asked and answers "allowed", so a suite with
// no bucket store can still see WHETHER the question was metered and on which
// key. Its real fail-open behaviour is covered in signin-rate-limit.test.ts.
vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkMagicLinkSendRateLimit: async (ip: string, email: string) => {
    hoisted.rateLimitCalls.push({ ip, email })
    return { allowed: true }
  },
}))

const { handlePortalSignin } = await import('../portal-signin')

/** Held by a user row here: a sign-in, which the workspace allows. */
const KNOWN = 'regular@acme.example'
/** No account, no invitation: the address the workspace refuses. */
const STRANGER = 'stranger@evil.example'

function post(email: string): Request {
  return new Request('https://acme.quackback.io/api/auth/portal-signin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ email, callbackURL: '/' }),
  })
}

interface Seen {
  status: number
  body: string
  headers: Array<[string, string]>
  emailsSent: number
}

async function ask(email: string): Promise<Seen> {
  hoisted.userFindFirst.mockResolvedValue(email === KNOWN ? { id: 'user_1' } : null)
  const res = await handlePortalSignin(post(email))
  return {
    status: res.status,
    body: await res.text(),
    headers: [...res.headers.entries()].sort(),
    emailsSent:
      hoisted.sendMagicLinkEmail.mock.calls.length +
      hoisted.sendSignupNotAllowedEmail.mock.calls.length,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.rateLimitCalls.length = 0
  // The steady state: an owner exists, nobody can claim it by arriving, and its
  // admin has closed self-service sign-ups. The only workspace in which the
  // per-address answer is interesting at all.
  hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: false } })
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
  hoisted.settingsFindFirst.mockResolvedValue({ name: 'Acme', logoKey: null })
})

describe('POST /api/auth/portal-signin — one answer for every address', () => {
  it('answers a known address and a stranger identically', async () => {
    const known = await ask(KNOWN)
    hoisted.sendMagicLinkEmail.mockClear()
    hoisted.sendSignupNotAllowedEmail.mockClear()
    const stranger = await ask(STRANGER)

    expect(stranger.status).toBe(known.status)
    expect(stranger.body).toBe(known.body)
    expect(stranger.headers).toEqual(known.headers)
  })

  it('answers an invited address and a stranger identically', async () => {
    hoisted.invitationFindFirst.mockResolvedValue({ id: 'invite_1' })
    const invited = await ask('newhire@acme.example')
    hoisted.invitationFindFirst.mockResolvedValue(null)
    hoisted.sendMagicLinkEmail.mockClear()
    hoisted.sendSignupNotAllowedEmail.mockClear()
    const stranger = await ask(STRANGER)

    expect(stranger.status).toBe(invited.status)
    expect(stranger.body).toBe(invited.body)
    expect(stranger.headers).toEqual(invited.headers)
  })

  // Not just the same answer: the same amount of the same kind of work. A
  // refusal that skipped the send would be a shorter request, which is the same
  // oracle read off the clock instead of off the status line.
  it('does the same work in both worlds — exactly one email either way', async () => {
    const known = await ask(KNOWN)
    hoisted.sendMagicLinkEmail.mockClear()
    hoisted.sendSignupNotAllowedEmail.mockClear()
    const stranger = await ask(STRANGER)

    expect(known.emailsSent).toBe(1)
    expect(stranger.emailsSent).toBe(1)
  })

  // The control the three assertions above depend on. If the policy is not
  // actually deciding differently, "indistinguishable" is a statement about a
  // gate that never ran.
  it('sees the two worlds as different underneath', async () => {
    await ask(KNOWN)
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
    expect(hoisted.sendSignupNotAllowedEmail).not.toHaveBeenCalled()

    vi.clearAllMocks()
    hoisted.settingsFindFirst.mockResolvedValue({ name: 'Acme', logoKey: null })
    await ask(STRANGER)
    expect(hoisted.sendSignupNotAllowedEmail).toHaveBeenCalledTimes(1)
    expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
    // And the mint never ran, so no redeemable row exists for the stranger.
    expect(hoisted.createVerificationValue).not.toHaveBeenCalled()
    expect(hoisted.createVerificationOTP).not.toHaveBeenCalled()
  })

  it('never names the code the policy refused with', async () => {
    const stranger = await ask(STRANGER)

    expect(stranger.body).not.toContain('signup_not_allowed')
    expect(stranger.body).not.toContain('accepting')
  })
})

describe('POST /api/auth/portal-signin — metered', () => {
  it('spends the same budget for a refused address as for a sent one', async () => {
    await ask(KNOWN)
    await ask(STRANGER)

    expect(hoisted.rateLimitCalls).toEqual([
      { ip: '203.0.113.7', email: KNOWN },
      { ip: '203.0.113.7', email: STRANGER },
    ])
  })

  // The limiter is spent BEFORE the workspace is read, so a refusal cannot be
  // cheaper than a send even in the number of round trips it costs the server.
  it('meters before it decides', async () => {
    await ask(STRANGER)

    expect(hoisted.rateLimitCalls).toHaveLength(1)
    expect(hoisted.getWorkspaceSettings).toHaveBeenCalled()
    expect(hoisted.rateLimitCalls[0]!.email).toBe(STRANGER)
  })

  it('refuses with 429 once the budget is gone, whatever the address is', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server/auth/signin-rate-limit', () => ({
      checkMagicLinkSendRateLimit: async () => ({ allowed: false, retryAfter: 42 }),
    }))
    const { handlePortalSignin: limited } = await import('../portal-signin')

    const res = await limited(post(STRANGER))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    vi.doUnmock('@/lib/server/auth/signin-rate-limit')
    vi.resetModules()
  })
})
