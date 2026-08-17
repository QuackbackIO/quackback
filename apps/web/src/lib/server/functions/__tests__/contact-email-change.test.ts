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
  getRequestHeaders: () => ({ 'x-forwarded-for': '203.0.113.7' }),
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
  enqueueMembershipSync: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { user: { findFirst: hoisted.findFirst } } },
  user: { id: 'user.id', email: 'user.email' },
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ kind: 'sql', strings, vals }),
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
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

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'usr_1' },
    principal: { type: 'user', role: 'user' },
  })
  hoisted.checkRateLimit.mockResolvedValue({ allowed: true })
  hoisted.checkVerificationOTP.mockResolvedValue({ success: true })
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
    hoisted.findFirst.mockReset()
    hoisted.findFirst.mockResolvedValueOnce({ id: 'usr_other' })

    const res = await call<{ ok: boolean; reason?: string }>(confirmEmailChangeFn, {
      email: 'Pat@Example.com',
      code: '123456',
    })

    expect(res).toEqual({ ok: false, reason: 'invalid_or_taken' })
    expect(hoisted.changeEmailEmailOTP).not.toHaveBeenCalled()
  })

  it('writes the address when the code checks out', async () => {
    hoisted.findFirst.mockReset()
    hoisted.findFirst.mockResolvedValueOnce(undefined)

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
    hoisted.findFirst.mockReset()
    hoisted.findFirst.mockResolvedValueOnce(undefined)
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
    })
    hoisted.findFirst.mockReset()
    hoisted.findFirst.mockResolvedValueOnce(undefined)

    await call(confirmEmailChangeFn, { email: REAL, code: '123456' })

    expect(hoisted.enqueueMembershipSync).toHaveBeenCalled()
  })

  it('does not enqueue membership-sync for an end-user address change', async () => {
    hoisted.findFirst.mockReset()
    hoisted.findFirst.mockResolvedValueOnce(undefined)

    await call(confirmEmailChangeFn, { email: REAL, code: '123456' })

    expect(hoisted.enqueueMembershipSync).not.toHaveBeenCalled()
  })
})
