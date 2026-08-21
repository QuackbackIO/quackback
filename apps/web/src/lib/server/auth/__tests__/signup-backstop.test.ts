/**
 * The backstop every Better-Auth account creation passes through.
 *
 * The per-endpoint gates are a list, and a list is only as good as whoever last
 * added a sign-up path to it. `/sign-in/social` is the standing proof: it
 * creates the account inside the provider callback, where Layer B has no email
 * and Layer C runs only after a session already exists. Nothing in the enumerated
 * gates can refuse it, so this is the thing that does.
 *
 * Driven directly, because that is the only way to drive it: the hook is a field
 * on the options object handed to `betterAuth()`, so an inline body would be
 * reachable only by standing up an entire auth instance — and a gate nobody can
 * exercise is a gate nobody has checked. The wiring itself is a bare reference
 * in `auth/index.ts`, which `tsc` matches against Better-Auth's own hook type.
 *
 * `false` is not decoration: it is Better-Auth's documented abort signal
 * (`with-hooks.ts`: `if (result === false) return null`). The assertions check
 * for exactly `false` rather than for falsiness, because `undefined` is the
 * "carry on" answer and the two differ by whether an account exists afterwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
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

// The anonymous-email predicate stays REAL. It is the exemption that decides
// whether the widget keeps working, and a stub for it could not tell a
// placeholder from a person.
const { guardBetterAuthUserCreation } = await import('../signup-policy')
const { ANON_EMAIL_DOMAIN } = await import('@/lib/shared/anonymous-email')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: false } })
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
})

describe('guardBetterAuthUserCreation', () => {
  // The social callback: the one account-creating path no enumerated gate can
  // see, and the reason this hook exists at all.
  it('aborts creation for a stranger on a workspace that has closed sign-ups', async () => {
    expect(await guardBetterAuthUserCreation({ email: 'stranger@evil.example' })).toBe(false)
  })

  it('carries on once the workspace opens sign-ups', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: true } })

    expect(await guardBetterAuthUserCreation({ email: 'stranger@evil.example' })).toBeUndefined()
  })

  it('carries on for an invited address', async () => {
    hoisted.invitationFindFirst.mockResolvedValue({ id: 'invite_1' })

    expect(await guardBetterAuthUserCreation({ email: 'newhire@acme.example' })).toBeUndefined()
  })

  it('carries on for the first user of an unclaimed, unprovisioned install', async () => {
    hoisted.findHumanAdmin.mockResolvedValue(undefined)
    hoisted.isOpenToBootstrapClaim.mockResolvedValue(true)

    expect(await guardBetterAuthUserCreation({ email: 'first@acme.example' })).toBeUndefined()
  })

  // The widget's lazy anonymous session. Blocking these would take the widget
  // down on every workspace that closed sign-ups, so the exemption is checked
  // before the policy is consulted at all.
  it('never blocks the anonymous placeholder the widget mints', async () => {
    const placeholder = `temp-abc123@${ANON_EMAIL_DOMAIN}`

    expect(await guardBetterAuthUserCreation({ email: placeholder })).toBeUndefined()
    expect(hoisted.getWorkspaceSettings).not.toHaveBeenCalled()
  })

  // The exemption is the reserved domain itself, not the `temp-` prefix or a
  // substring of it: an attacker-registrable lookalike must not inherit it.
  it('does not extend that exemption to a lookalike domain', async () => {
    expect(
      await guardBetterAuthUserCreation({ email: `temp-abc123@${ANON_EMAIL_DOMAIN}.evil.example` })
    ).toBe(false)
  })

  // A creation with no usable address is not something to wave through: there
  // is no address to check an exemption against.
  it('aborts a creation carrying no address at all', async () => {
    expect(await guardBetterAuthUserCreation({})).toBe(false)
  })
})

/**
 * `false` is the documented abort, and most creating paths turn it into a
 * redirect. One does not.
 *
 * Better-Auth 1.6.16's `plugins/email-otp/routes.mjs` consumes the code with
 * `atomicVerifyOTP`, calls `createUser`, and reads `newUser.id` with no null
 * check — so aborting there is a raw 500 AFTER the code is spent, and the
 * person cannot retry with it. Being told the reason is strictly better, and it
 * is the difference between an error page and an explanation.
 */
describe('guardBetterAuthUserCreation — the path that cannot survive an abort', () => {
  it('throws rather than aborting on the one-time-code redemption', async () => {
    await expect(
      guardBetterAuthUserCreation(
        { email: 'stranger@evil.example' },
        { path: '/sign-in/email-otp' }
      )
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'signup_not_allowed' },
    })
  })

  // The control, and the reason this is a list rather than a blanket change:
  // the paths that DO check for null handle the redirect better than a thrown
  // error would, which lands as a raw error page mid-navigation.
  it('still aborts with false on a path that checks the result', async () => {
    expect(
      await guardBetterAuthUserCreation(
        { email: 'stranger@evil.example' },
        { path: '/magic-link/verify' }
      )
    ).toBe(false)
  })

  it('still aborts with false when Better-Auth supplies no context at all', async () => {
    expect(await guardBetterAuthUserCreation({ email: 'stranger@evil.example' }, null)).toBe(false)
  })

  // The exemptions come first either way: a workspace that allows the account
  // must not get an exception thrown at it because of which path it arrived on.
  it('does not throw on that path when the account is allowed', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: true } })

    await expect(
      guardBetterAuthUserCreation({ email: 'anyone@example.com' }, { path: '/sign-in/email-otp' })
    ).resolves.toBeUndefined()
  })
})
