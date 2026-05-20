/**
 * Tests for the workspace `Require 2FA` policy.
 *
 * Two layers covered here:
 *  1. `shouldRequire2FA` — the pure predicate. Exhaustively covers the
 *     branches (toggle, role, enrollment).
 *  2. `handleCredentialPostSignInGate` — the after-hook handler that
 *     consumes the predicate. Verifies that on a credential sign-in
 *     success we look up the post-auth user, run the predicate, and
 *     (only when blocked) delete the just-created session row and throw
 *     a redirect to `/auth/two-factor-setup-required`. Mock shape mirrors
 *     `jit-role.test.ts`.
 *
 * The gate used to live in `hooksBefore` which leaked account state —
 * an unauth'd attacker could probe `email=…&password=garbage` and read
 * the redirect to enumerate team-role users without 2FA. We now run the
 * check post-password-verification.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { shouldRequire2FA, evaluateMagicLinkTwoFactor } from '../two-factor-policy'

describe('shouldRequire2FA', () => {
  it('returns false when the workspace toggle is off', () => {
    expect(
      shouldRequire2FA({
        role: 'admin',
        userHas2FA: false,
        workspaceRequired: false,
      })
    ).toBe(false)
  })

  it('returns false for portal users (role=user) regardless of toggle', () => {
    expect(
      shouldRequire2FA({
        role: 'user',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe(false)
  })

  it('returns true for team-role user without 2FA when required', () => {
    expect(
      shouldRequire2FA({
        role: 'admin',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe(true)
    expect(
      shouldRequire2FA({
        role: 'member',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe(true)
  })

  it('returns false when user already has 2FA enrolled', () => {
    expect(
      shouldRequire2FA({
        role: 'admin',
        userHas2FA: true,
        workspaceRequired: true,
      })
    ).toBe(false)
    expect(
      shouldRequire2FA({
        role: 'member',
        userHas2FA: true,
        workspaceRequired: true,
      })
    ).toBe(false)
  })
})

// --- handleCredentialPostSignInGate ---

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockDeleteWhere = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  user: { id: 'user_id', email: 'user_email' },
  principal: { userId: 'principal_userId', role: 'role' },
  session: { token: 'session_token' },
  eq: vi.fn(),
}))

vi.mock('better-auth/cookies', () => ({
  deleteSessionCookie: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockDelete.mockReturnValue({ where: mockDeleteWhere })
  mockDeleteWhere.mockResolvedValue(undefined)
})

type GateCtx = {
  path?: string
  context?: { newSession?: { user?: { id?: string }; session?: { token?: string } } | null }
  redirect: (url: string) => Error
}

const tenantWithRequired = (required: boolean) =>
  ({
    authConfig: { twoFactor: { required } },
  }) as unknown as Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >

const buildCtx = (overrides: Partial<GateCtx> = {}): GateCtx => {
  const redirect = vi.fn((url: string) => new Error(`REDIRECT:${url}`))
  return {
    path: '/sign-in/email',
    context: {
      newSession: {
        user: { id: 'user_abc' },
        session: { token: 'tok_abc' },
      },
    },
    redirect,
    ...overrides,
  }
}

const callGate = async (ctx: GateCtx, required: boolean) => {
  const mod = (await import('../hooks')) as typeof import('../hooks') & {
    handleCredentialPostSignInGate: (
      ctx: GateCtx,
      tenant: Awaited<
        ReturnType<
          typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings
        >
      >
    ) => Promise<void>
  }
  const handler = mod.handleCredentialPostSignInGate
  if (!handler) throw new Error('handleCredentialPostSignInGate must be exported')
  return handler(ctx, tenantWithRequired(required))
}

describe('handleCredentialPostSignInGate', () => {
  it('revokes session and redirects when team-role user has no 2FA and workspace requires it', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx()

    await expect(callGate(ctx, true)).rejects.toThrow('REDIRECT:/auth/two-factor-setup-required')

    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1)
    expect(ctx.redirect).toHaveBeenCalledWith('/auth/two-factor-setup-required')
  })

  it('does NOT revoke or redirect when the user already has 2FA enrolled', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: true })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx()

    await callGate(ctx, true)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does NOT revoke or redirect when the principal role is `user` (portal)', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = buildCtx()

    await callGate(ctx, true)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does NOT revoke or redirect when the workspace toggle is off', async () => {
    // No DB lookups should fire — the early-return on the toggle wins.
    const ctx = buildCtx()

    await callGate(ctx, false)

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockPrincipalFindFirst).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('bails when path is not a credential sign-in', async () => {
    const ctx = buildCtx({ path: '/oauth2/callback/:providerId' })

    await callGate(ctx, true)

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('bails when newSession is missing (Better-Auth twoFactor plugin already intercepted)', async () => {
    const ctx = buildCtx({ context: { newSession: null } })

    await callGate(ctx, true)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('member role also gets gated when missing 2FA', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    const ctx = buildCtx()

    await expect(callGate(ctx, true)).rejects.toThrow('REDIRECT:/auth/two-factor-setup-required')
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })
})

// --- evaluateMagicLinkTwoFactor (pure predicate, 3-state) ---

describe('evaluateMagicLinkTwoFactor', () => {
  it('returns allow when workspace toggle is off (any role / enrollment)', () => {
    for (const role of ['admin', 'member', 'user'] as const) {
      for (const userHas2FA of [true, false]) {
        expect(evaluateMagicLinkTwoFactor({ role, userHas2FA, workspaceRequired: false })).toBe(
          'allow'
        )
      }
    }
  })

  it('returns allow for portal users regardless of enrollment under required=true', () => {
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'user',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe('allow')
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'user',
        userHas2FA: true,
        workspaceRequired: true,
      })
    ).toBe('allow')
  })

  it('returns setup-required for team user without 2FA when workspace required', () => {
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'admin',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe('setup-required')
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'member',
        userHas2FA: false,
        workspaceRequired: true,
      })
    ).toBe('setup-required')
  })

  it('returns use-password for team user WITH 2FA enrolled when workspace required', () => {
    // Magic-link bypasses Better-Auth's TOTP challenge — we refuse and
    // steer them to the password+TOTP path.
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'admin',
        userHas2FA: true,
        workspaceRequired: true,
      })
    ).toBe('use-password')
    expect(
      evaluateMagicLinkTwoFactor({
        role: 'member',
        userHas2FA: true,
        workspaceRequired: true,
      })
    ).toBe('use-password')
  })
})

// --- handleMagicLinkPostSignInGate (post-session magic-link gate) ---

const MAGIC_LINK_PATHS = ['/magic-link/verify', '/sign-in/email-otp']

const callMagicLinkGate = async (ctx: GateCtx, required: boolean) => {
  const mod = (await import('../hooks')) as typeof import('../hooks') & {
    handleMagicLinkPostSignInGate?: (
      ctx: GateCtx,
      tenant: Awaited<
        ReturnType<
          typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings
        >
      >
    ) => Promise<void>
  }
  const handler = mod.handleMagicLinkPostSignInGate
  if (!handler) throw new Error('handleMagicLinkPostSignInGate must be exported')
  return handler(ctx, tenantWithRequired(required))
}

describe('handleMagicLinkPostSignInGate', () => {
  it('redirects unenrolled team user to /auth/two-factor-setup-required', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx({ path: '/magic-link/verify' })

    await expect(callMagicLinkGate(ctx, true)).rejects.toThrow(
      'REDIRECT:/auth/two-factor-setup-required'
    )

    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('refuses enrolled team user with use_password_for_2fa redirect', async () => {
    // Enrolled user tried magic-link — BA twoFactor plugin only
    // challenges on password paths. Force them to password+TOTP.
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: true })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx({ path: '/magic-link/verify' })

    await expect(callMagicLinkGate(ctx, true)).rejects.toThrow(
      'REDIRECT:/admin/login?error=use_password_for_2fa'
    )

    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('refuses enrolled member too (gate is role-uniform across team)', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: true })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    const ctx = buildCtx({ path: '/magic-link/verify' })

    await expect(callMagicLinkGate(ctx, true)).rejects.toThrow(/use_password_for_2fa/)
  })

  it('allows portal user magic-link even when workspace required (team policy only)', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = buildCtx({ path: '/magic-link/verify' })

    await callMagicLinkGate(ctx, true)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('allows magic-link when workspace toggle is off', async () => {
    const ctx = buildCtx({ path: '/magic-link/verify' })

    await callMagicLinkGate(ctx, false)

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('also fires on /sign-in/email-otp (email-OTP shares the magic-link plugin)', async () => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: true })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx({ path: '/sign-in/email-otp' })

    await expect(callMagicLinkGate(ctx, true)).rejects.toThrow(/use_password_for_2fa/)
  })

  it('does NOT fire on credential paths (handled by the other gate)', async () => {
    const ctx = buildCtx({ path: '/sign-in/email' })

    await callMagicLinkGate(ctx, true)

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('does NOT fire on /sign-in/magic-link (the send endpoint — no session yet)', async () => {
    // `/sign-in/magic-link` sends the email but doesn't create a session.
    // The gate only fires on verify paths where newSession exists.
    const ctx = buildCtx({ path: '/sign-in/magic-link' })

    await callMagicLinkGate(ctx, true)

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('bails when newSession is missing', async () => {
    const ctx = buildCtx({ path: '/magic-link/verify', context: { newSession: null } })

    await callMagicLinkGate(ctx, true)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  // Sanity: the path set is exhaustive — the gate fires on every magic-
  // link path that creates a session.
  it.each(MAGIC_LINK_PATHS)('fires on %s', async (path) => {
    mockUserFindFirst.mockResolvedValue({ twoFactorEnabled: false })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = buildCtx({ path })

    await expect(callMagicLinkGate(ctx, true)).rejects.toThrow(/two-factor-setup-required/)
  })
})
