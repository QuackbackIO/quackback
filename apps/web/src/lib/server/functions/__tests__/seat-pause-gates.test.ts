/**
 * The session gates and a paused seat (the plan has fewer team seats than
 * members, after the grace, and this person is not a seat holder).
 *
 * The plan limits answer is a stand-in keyed on the principal it is asked
 * about, exactly as the real `isSeatPaused` is; whether that answer is right
 * (owner and billing rights never paused, inert in grace and without plan
 * billing) is proved against a real database in plan-limits.team.db.test.ts.
 * Here: what each gate does with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSeatPausedError } from '@/lib/shared/billing/seat-paused'

const hoisted = vi.hoisted(() => ({
  paused: new Set<string>(),
  asked: [] as string[],
  session: null as null | { session: { scope: string }; user: Record<string, unknown> },
  principal: null as null | { id: string; role: string; type: string },
  handlers: [] as Array<(args: { data: Record<string, unknown> }) => Promise<unknown>>,
}))

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isSeatPaused: async (principalId: string) => {
    hoisted.asked.push(principalId)
    return hoisted.paused.has(principalId)
  },
}))
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: (typeof hoisted.handlers)[number]) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/auth/request-session', () => ({
  IDENTITY_MEMO_PREFIX: 'identity:',
  getRequestSession: async () => hoisted.session,
  getRequestPrincipal: async () => hoisted.principal,
  getRequestPermissions: async () => new Set(['settings.manage', 'member.view']),
  rememberRequestPrincipal: () => undefined,
}))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => hoisted.session }))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettingsCached: async () => ({ id: 'workspace_1', slug: 'acme', name: 'Acme' }),
  findSettingsCached: async () => ({ id: 'workspace_1', slug: 'acme', name: 'Acme' }),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const { requireAuth, getOptionalAuth, isAuthDenialError } = await import('../auth-helpers')
await import('../workspace-utils')
const requireWorkspaceRole = hoisted.handlers[0]!

function signIn(scope: 'dashboard' | 'portal', principal: { id: string; role: string }) {
  hoisted.session = {
    session: { scope },
    user: { id: 'user_1', email: 'alex@example.com', name: 'Alex', image: null },
  }
  hoisted.principal = { ...principal, type: 'user' }
}

beforeEach(() => {
  hoisted.paused = new Set()
  hoisted.asked = []
})

describe('requireAuth', () => {
  it('refuses a permission-gated call from a paused seat with the paused-seat denial', async () => {
    signIn('dashboard', { id: 'principal_paused', role: 'member' })
    hoisted.paused.add('principal_paused')
    const err = await requireAuth({ permission: 'settings.manage' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Your admin access is paused.')
    expect(isSeatPausedError(err)).toBe(true)
    // An auth denial, so production keeps its words rather than masking them.
    expect(isAuthDenialError(err)).toBe(true)
  })

  it('gives a paused seat a portal context with no team authority', async () => {
    signIn('dashboard', { id: 'principal_paused', role: 'admin' })
    hoisted.paused.add('principal_paused')
    const auth = await requireAuth()
    expect(auth.principal.role).toBe('user')
    expect(auth.permissions).toEqual([])
  })

  it('leaves a seat holder alone', async () => {
    signIn('dashboard', { id: 'principal_holder', role: 'member' })
    hoisted.paused.add('principal_paused')
    const auth = await requireAuth({ permission: 'settings.manage' })
    expect(auth.principal.role).toBe('member')
    expect(auth.permissions).toContain('settings.manage')
    expect(hoisted.asked).toEqual(['principal_holder'])
  })

  it('never asks for a portal session or a portal user', async () => {
    signIn('portal', { id: 'principal_paused', role: 'member' })
    hoisted.paused.add('principal_paused')
    expect((await requireAuth()).principal.role).toBe('user')
    signIn('dashboard', { id: 'principal_visitor', role: 'user' })
    await requireAuth()
    expect(hoisted.asked).toEqual([])
  })
})

describe('getOptionalAuth', () => {
  it('keeps a paused seat signed in, as a portal user', async () => {
    signIn('dashboard', { id: 'principal_paused', role: 'member' })
    hoisted.paused.add('principal_paused')
    const auth = await getOptionalAuth()
    expect(auth?.principal.id).toBe('principal_paused')
    expect(auth?.principal.role).toBe('user')
    expect(auth?.permissions).toEqual([])
  })

  it('leaves a seat holder alone', async () => {
    signIn('dashboard', { id: 'principal_holder', role: 'admin' })
    const auth = await getOptionalAuth()
    expect(auth?.principal.role).toBe('admin')
    expect(auth?.permissions).toContain('settings.manage')
  })
})

describe('requireWorkspaceRole (the admin route guard)', () => {
  it('refuses a paused seat on a team route with the paused-seat denial', async () => {
    signIn('dashboard', { id: 'principal_paused', role: 'member' })
    hoisted.paused.add('principal_paused')
    const err = await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'], callbackUrl: '/admin' },
    }).catch((e: unknown) => e)
    expect(isSeatPausedError(err)).toBe(true)
  })

  it('lets a seat holder in', async () => {
    signIn('dashboard', { id: 'principal_holder', role: 'admin' })
    hoisted.paused.add('principal_paused')
    const result = (await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'] },
    })) as { permissions: string[] }
    expect(result.permissions).toContain('settings.manage')
  })

  it('never asks on a route open to portal users', async () => {
    signIn('dashboard', { id: 'principal_paused', role: 'member' })
    hoisted.paused.add('principal_paused')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member', 'user'] } })
    expect(hoisted.asked).toEqual([])
  })
})
