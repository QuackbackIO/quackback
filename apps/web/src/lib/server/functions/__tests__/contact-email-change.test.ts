/**
 * The email set/change flow.
 *
 * Two properties are worth a test, and both are invisible to typecheck:
 *
 *  1. WHICH Better Auth endpoint step 1 calls. The code the new address
 *     receives is keyed on the pair (current address, new address), and that is
 *     what step 2 looks up. `sendVerificationOTP` writes a code keyed on the
 *     address alone, so wiring step 1 to it produces a flow that sends nothing
 *     and then rejects every code — silently, because both steps still return
 *     a success shape. Only `requestEmailChangeEmailOTP` writes the key step 2
 *     reads, so the choice of endpoint is pinned here.
 *
 *  2. That the current-address code is required, and spent. It is the whole
 *     defence against a stolen session rebinding the account, and Better Auth's
 *     `checkVerificationOTP` is non-consuming by design.
 *
 * Uses the `createServerFn` capture pattern from the sibling suites, except the
 * mocked `.handler(fn)` returns the handler itself so each function is reached
 * by name. Indexing a positional array of handlers breaks the moment a function
 * is added above another, which has caught this repo before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  // The client also writes the private client-IP header Better Auth trusts;
  // nothing it forwards may carry that copy.
  getRequestHeaders: () =>
    new Headers({ 'x-forwarded-for': '9.9.9.9', 'x-quackback-client-ip': '9.9.9.9' }),
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findFirst: vi.fn(),
  sendVerificationOTP: vi.fn().mockResolvedValue({ success: true }),
  requestEmailChangeEmailOTP: vi.fn().mockResolvedValue({ success: true }),
  changeEmailEmailOTP: vi.fn().mockResolvedValue({ success: true }),
  checkVerificationOTP: vi.fn().mockResolvedValue({ success: true }),
  deleteVerificationByIdentifier: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  enqueueMembershipSync: vi.fn(async (..._args: unknown[]) => {}),
  providers: [] as unknown[],
  accountFindFirst: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: hoisted.findFirst },
      account: { findFirst: (...a: unknown[]) => hoisted.accountFindFirst(...a) },
    },
  },
  user: { id: 'user.id', email: 'user.email' },
  account: { userId: 'account.userId', providerId: 'account.providerId' },
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ kind: 'sql', strings, vals }),
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
  and: (...parts: unknown[]) => ({ kind: 'and', parts }),
}))

vi.mock('@/lib/server/auth', () => ({
  getAuth: async () => ({
    api: {
      sendVerificationOTP: hoisted.sendVerificationOTP,
      requestEmailChangeEmailOTP: hoisted.requestEmailChangeEmailOTP,
      changeEmailEmailOTP: hoisted.changeEmailEmailOTP,
      checkVerificationOTP: hoisted.checkVerificationOTP,
    },
    $context: Promise.resolve({
      internalAdapter: { deleteVerificationByIdentifier: hoisted.deleteVerificationByIdentifier },
    }),
  }),
}))

vi.mock('@/lib/server/domains/principals/contact-email', async () => {
  // The reserved domain comes from the one constant that owns it; re-typing the
  // literal here would let the mock keep passing after the real domain moved.
  const { ANON_EMAIL_DOMAIN } = await import('@/lib/shared/anonymous-email')
  return {
    acceptableContactEmail: (e: string) => {
      const v = e.trim().toLowerCase()
      return v.includes('@') && !v.endsWith(`@${ANON_EMAIL_DOMAIN}`) ? v : null
    },
  }
})

vi.mock('@/lib/server/domains/api/rate-limit', () => ({ getClientIp: () => '203.0.113.7' }))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => hoisted.providers,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set(['oidc_acme']),
}))
vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkContactEmailSendRateLimit: hoisted.checkRateLimit,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: (...args: unknown[]) => hoisted.enqueueMembershipSync(...args),
}))

import {
  sendCurrentAddressCodeFn,
  requestEmailChangeFn,
  confirmEmailChangeFn,
} from '../contact-email'

const PLACEHOLDER = 'temp-abc123@anon.quackback.io'
const REAL = 'pat@example.com'

/** The handlers are plain functions under the mock; the wrappers' types are not. */
const call = <T>(fn: unknown, data?: unknown): Promise<T> =>
  (fn as (a: { data?: unknown }) => Promise<T>)({ data })

/** `userRow` reads first; anything after it in the same handler follows. */
const accountIs = (email: string) => {
  hoisted.findFirst.mockReset()
  hoisted.findFirst.mockResolvedValueOnce({ id: 'usr_1', email })
}

/** Confirm re-reads the account first, then looks for another holder of the address. */
const confirmingFrom = (email: string, holder?: { id: string }) => {
  hoisted.findFirst.mockReset()
  hoisted.findFirst.mockResolvedValueOnce({ id: 'usr_1', email }).mockResolvedValueOnce(holder)
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'usr_1' },
    principal: { type: 'user', role: 'user' },
    scope: 'dashboard',
  })
  hoisted.checkRateLimit.mockResolvedValue({ allowed: true })
  hoisted.checkVerificationOTP.mockResolvedValue({ success: true })
  hoisted.providers = []
  hoisted.accountFindFirst.mockResolvedValue(undefined)
})

describe('requestEmailChangeFn', () => {
  it('asks Better Auth for a CHANGE code, not a plain verification code', async () => {
    // The bug this pins: a plain verification code is keyed on the new address
    // alone, is never sent because no account holds that address yet, and can
    // never be found by step 2.
    accountIs(PLACEHOLDER)

    await call(requestEmailChangeFn, { email: REAL })

    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newEmail: REAL } })
    )
    expect(hoisted.sendVerificationOTP).not.toHaveBeenCalled()
  })

  it('skips the current-address code when the account has no reachable address', async () => {
    accountIs(PLACEHOLDER)

    await call(requestEmailChangeFn, { email: REAL })

    expect(hoisted.checkVerificationOTP).not.toHaveBeenCalled()
    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalled()
  })

  it('refuses to send anywhere when a reachable account omits the current code', async () => {
    accountIs(REAL)

    await expect(call(requestEmailChangeFn, { email: 'new@example.com' })).rejects.toThrow(
      /current address/i
    )
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('refuses to send anywhere when the current code is wrong', async () => {
    accountIs(REAL)
    hoisted.checkVerificationOTP.mockRejectedValueOnce(new Error('INVALID_OTP'))

    await expect(
      call(requestEmailChangeFn, { email: 'new@example.com', currentCode: '000000' })
    ).rejects.toThrow(/not right|expired/i)
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('spends the current-address code, so it cannot be replayed', async () => {
    accountIs(REAL)

    await call(requestEmailChangeFn, { email: 'new@example.com', currentCode: '123456' })

    expect(hoisted.checkVerificationOTP).toHaveBeenCalled()
    expect(hoisted.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      `email-verification-otp-${REAL}`
    )
    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalled()
  })

  it('rejects the address the account already has', async () => {
    accountIs(REAL)

    await expect(
      call(requestEmailChangeFn, { email: REAL.toUpperCase(), currentCode: '123456' })
    ).rejects.toThrow(/already your email/i)
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('sends nothing once rate limited', async () => {
    accountIs(PLACEHOLDER)
    hoisted.checkRateLimit.mockResolvedValueOnce({ allowed: false })

    await expect(call(requestEmailChangeFn, { email: REAL })).rejects.toThrow(/too many/i)
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })
})

describe('sendCurrentAddressCodeFn', () => {
  it('is rate limited, because auth.api calls bypass the plugin path matchers', async () => {
    accountIs(REAL)
    hoisted.checkRateLimit.mockResolvedValueOnce({ allowed: false })

    await expect(call(sendCurrentAddressCodeFn)).rejects.toThrow(/too many/i)
    expect(hoisted.sendVerificationOTP).not.toHaveBeenCalled()
  })

  it('refuses when there is no reachable address to prove', async () => {
    accountIs(PLACEHOLDER)

    await expect(call(sendCurrentAddressCodeFn)).rejects.toThrow(/no confirmed address/i)
    expect(hoisted.sendVerificationOTP).not.toHaveBeenCalled()
  })
})

describe('confirmEmailChangeFn', () => {
  it('refuses an address a mixed-case row already holds', async () => {
    // Better Auth lowercases the address it searches for but compares it
    // against stored values as-is, and the unique index is case-sensitive, so
    // without this check one address ends up with two identities.
    confirmingFrom('old@example.com', { id: 'usr_other' })

    const res = await call<{ ok: boolean; reason?: string }>(confirmEmailChangeFn, {
      email: 'Pat@Example.com',
      code: '123456',
    })

    expect(res).toEqual({ ok: false, reason: 'invalid_or_taken' })
    expect(hoisted.changeEmailEmailOTP).not.toHaveBeenCalled()
  })

  it('writes the address when the code checks out', async () => {
    confirmingFrom('old@example.com')

    const res = await call<{ ok: boolean; email?: string }>(confirmEmailChangeFn, {
      email: REAL,
      code: '123456',
    })

    expect(res).toEqual({ ok: true, email: REAL })
    expect(hoisted.changeEmailEmailOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newEmail: REAL, otp: '123456' } })
    )
  })

  it('reports a bad code and a taken address identically', async () => {
    confirmingFrom('old@example.com')
    hoisted.changeEmailEmailOTP.mockRejectedValueOnce(new Error('INVALID_OTP'))

    const res = await call<{ ok: boolean; reason?: string }>(confirmEmailChangeFn, {
      email: REAL,
      code: '999999',
    })

    expect(res).toEqual({ ok: false, reason: 'invalid_or_taken' })
    expect(hoisted.enqueueMembershipSync).not.toHaveBeenCalled()
  })

  it('enqueues membership-sync when a teammate confirms a new address', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'usr_1' },
      principal: { type: 'user', role: 'member' },
      scope: 'dashboard',
    })
    confirmingFrom('old@example.com')

    await call(confirmEmailChangeFn, { email: REAL, code: '123456' })

    expect(hoisted.enqueueMembershipSync).toHaveBeenCalled()
  })

  it('does not enqueue membership-sync for an end-user address change', async () => {
    confirmingFrom('old@example.com')

    await call(confirmEmailChangeFn, { email: REAL, code: '123456' })

    expect(hoisted.enqueueMembershipSync).not.toHaveBeenCalled()
  })
})

describe('widget-scoped sessions cannot change email', () => {
  beforeEach(() => {
    hoisted.requireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )
  })

  it('rejects requestEmailChangeFn', async () => {
    accountIs(PLACEHOLDER)
    await expect(call(requestEmailChangeFn, { email: REAL })).rejects.toThrow(/Widget sessions/)
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('rejects confirmEmailChangeFn', async () => {
    await expect(call(confirmEmailChangeFn, { email: REAL, code: '123456' })).rejects.toThrow(
      /Widget sessions/
    )
    expect(hoisted.changeEmailEmailOTP).not.toHaveBeenCalled()
  })
})

describe('headers forwarded to Better Auth', () => {
  /** The client-IP header each Better Auth call received. */
  const forwardedIps = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.map(([arg]) => (arg as { headers: Headers }).headers.get('x-quackback-client-ip'))

  it('carry the resolved client address, never the client-supplied one', async () => {
    accountIs(REAL)
    await call(sendCurrentAddressCodeFn)

    accountIs(REAL)
    await call(requestEmailChangeFn, { email: 'new@example.com', currentCode: '123456' })

    confirmingFrom('old@example.com')
    await call(confirmEmailChangeFn, { email: REAL, code: '123456' })

    for (const fn of [
      hoisted.sendVerificationOTP,
      hoisted.checkVerificationOTP,
      hoisted.requestEmailChangeEmailOTP,
      hoisted.changeEmailEmailOTP,
    ]) {
      expect(forwardedIps(fn)).toEqual(['203.0.113.7'])
    }
  })
})

// A verified domain that requires SSO owns its addresses. Moving off one would
// let the person sign in with an email link instead of the provider; moving
// onto one would put the account behind a provider it may not use.
describe('a domain that requires SSO', () => {
  const SSO = 'sam@acme.com'

  beforeEach(() => {
    hoisted.providers = [
      {
        id: 'idp_acme',
        registrationId: 'oidc_acme',
        showButton: true,
        domains: [{ name: 'acme.com', enforced: true, verifiedAt: '2026-01-01T00:00:00Z' }],
      },
    ]
  })

  it('sends no current-address code for a managed address', async () => {
    accountIs(SSO)

    await expect(call(sendCurrentAddressCodeFn)).rejects.toThrow(/single sign-on/i)
    expect(hoisted.sendVerificationOTP).not.toHaveBeenCalled()
  })

  it('refuses to move off a managed address, even with a good current code', async () => {
    accountIs(SSO)

    await expect(
      call(requestEmailChangeFn, { email: 'sam@gmail.com', currentCode: '123456' })
    ).rejects.toThrow(/single sign-on/i)
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('refuses to move onto a managed domain', async () => {
    accountIs(PLACEHOLDER)

    await expect(call(requestEmailChangeFn, { email: 'new@acme.com' })).rejects.toThrow(
      /single sign-on/i
    )
    expect(hoisted.requestEmailChangeEmailOTP).not.toHaveBeenCalled()
  })

  it('refuses to write a managed address at confirm time', async () => {
    confirmingFrom(PLACEHOLDER)

    const res = await call<{ ok: boolean }>(confirmEmailChangeFn, {
      email: 'new@acme.com',
      code: '123456',
    })

    expect(res.ok).toBe(false)
    expect(hoisted.changeEmailEmailOTP).not.toHaveBeenCalled()
  })

  // Someone whose provider released no email signs in through the domain's own
  // provider; the rule is there to keep them on it, not to stop them naming
  // their address there.
  it('lets an account that signs in through the owning provider add an address there', async () => {
    accountIs(PLACEHOLDER)
    hoisted.accountFindFirst.mockResolvedValue({ id: 'acc_1' })

    await call(requestEmailChangeFn, { email: 'new@acme.com' })

    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalled()
  })

  // The SSO answer is checked before the holder lookup, so it cannot tell a
  // caller which addresses at the domain hold accounts.
  it('answers the same at confirm whether or not the managed address is taken', async () => {
    confirmingFrom(PLACEHOLDER, { id: 'usr_other' })
    const taken = await call<{ ok: boolean; reason?: string }>(confirmEmailChangeFn, {
      email: 'ceo@acme.com',
      code: '000000',
    })
    confirmingFrom(PLACEHOLDER, undefined)
    const free = await call<{ ok: boolean; reason?: string }>(confirmEmailChangeFn, {
      email: 'nobody@acme.com',
      code: '000000',
    })

    expect(taken).toEqual({ ok: false, reason: 'sso_managed' })
    expect(free).toEqual(taken)
  })

  it('lets an account on the owning provider correct its address within the domain', async () => {
    accountIs(SSO)
    hoisted.accountFindFirst.mockResolvedValue({ id: 'acc_1' })

    await call(requestEmailChangeFn, { email: 'sam.lee@acme.com', currentCode: '123456' })

    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalled()
  })

  it('still keeps that account from moving off the domain', async () => {
    accountIs(SSO)
    hoisted.accountFindFirst.mockResolvedValue({ id: 'acc_1' })

    await expect(
      call(requestEmailChangeFn, { email: 'sam@gmail.com', currentCode: '123456' })
    ).rejects.toThrow(/single sign-on/i)
  })

  it('sends a current-address code to a managed address on the owning provider', async () => {
    accountIs(SSO)
    hoisted.accountFindFirst.mockResolvedValue({ id: 'acc_1' })

    await call(sendCurrentAddressCodeFn)

    expect(hoisted.sendVerificationOTP).toHaveBeenCalled()
  })

  it('still moves between addresses at other domains', async () => {
    accountIs(REAL)

    await call(requestEmailChangeFn, { email: 'pat@example.org', currentCode: '123456' })

    expect(hoisted.requestEmailChangeEmailOTP).toHaveBeenCalled()
  })
})
