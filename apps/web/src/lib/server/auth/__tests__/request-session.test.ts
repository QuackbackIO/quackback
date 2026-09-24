/**
 * One session and one principal read per request, whoever asks.
 *
 * The bootstrap payload, the portal gate, the auth helpers behind every server
 * function and the session helper each ask who the caller is. These tests drive
 * the real production readers inside a request scope and count what reaches
 * Better Auth and the principal table, then prove the memo never outlives the
 * request, never crosses users or workspaces, and lets go after a write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Request headers: whatever the current test's request carries ---------

let currentHeaders = new Headers()
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => currentHeaders,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
  createServerOnlyFn: <T>(fn: T) => fn,
}))

// --- Better Auth: resolves the session named by the request's cookie -------

interface FakeSession {
  session: {
    id: string
    token: string
    scope: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
  }
  user: {
    id: string
    email: string
    name: string
    image: string | null
    emailVerified: boolean
    createdAt: Date
    updatedAt: Date
  }
}

const sessionsByToken = new Map<string, FakeSession>()
const mockGetSession = vi.fn(async ({ headers }: { headers: Headers }) => {
  const cookie = headers.get('cookie') ?? ''
  const token = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1]
  return (token && sessionsByToken.get(token)) || null
})
vi.mock('@/lib/server/auth/index', () => ({
  auth: { api: { getSession: (input: { headers: Headers }) => mockGetSession(input) } },
}))

// --- Database: principal rows by user id, answered from the WHERE clause ---

interface FakePrincipal {
  id: string
  userId: string
  role: string
  type: string
}
const principalsByUser = new Map<string, FakePrincipal>()
const mockPrincipalFindFirst = vi.fn(async (args: { where: { col: string; val: string } }) => {
  expect(args.where.col).toBe('principal.userId')
  return principalsByUser.get(args.where.val)
})
const mockSettingsFindFirst = vi.fn(async () => ({ id: 'settings_1', portalConfig: null }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (args: never) => mockPrincipalFindFirst(args) },
      settings: { findFirst: () => mockSettingsFindFirst() },
      invitation: { findFirst: vi.fn(async () => undefined) },
      widgetOriginSession: { findFirst: vi.fn(async () => undefined) },
    },
    execute: vi.fn(async () => []),
  },
  principal: { userId: 'principal.userId' },
  invitation: {},
  widgetOriginSession: {},
  eq: (col: string, val: string) => ({ col, val }),
  and: (...parts: unknown[]) => ({ parts }),
  sql: () => ({}),
}))

// --- Collaborators outside identity ----------------------------------------

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettingsCached: vi.fn(async () => ({
    id: 'workspace_1',
    slug: 'main',
    name: 'Main',
    logoKey: null,
  })),
}))

const mockPermissionsForPrincipal = vi.fn(
  async (_principalId: string, _role: string) => new Set(['settings.manage'])
)
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: (principalId: string, role: string) =>
    mockPermissionsForPrincipal(principalId, role),
}))

// Read-first, create-if-missing, like the real factory: its read is a
// principal read like any other.
async function fakeEnsurePrincipal({ userId }: { userId: string }) {
  const existing = await mockPrincipalFindFirst({ where: { col: 'principal.userId', val: userId } })
  if (existing) return { principal: existing, created: false }
  const created = { id: `principal_new_${userId}`, userId, role: 'user', type: 'user' }
  principalsByUser.set(userId, created)
  return { principal: created, created: true }
}
const mockEnsurePrincipal = vi.fn(fakeEnsurePrincipal)
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: (input: { userId: string }) => mockEnsurePrincipal(input),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set()),
}))

let portalVisibility: 'public' | 'private' = 'private'
const mockGetPortalConfig = vi.fn(async () => ({ access: { visibility: portalVisibility } }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: () => mockGetPortalConfig(),
}))

const { runWithLogContext } = await import('@/lib/server/log-context')
const { getSession } = await import('../session')
const { requireAuth, getOptionalAuth } = await import('@/lib/server/functions/auth-helpers')
const { resolvePortalAccessForRequest } = await import('@/lib/server/functions/portal-access')
const { getCurrentUserRole } = await import('@/lib/server/functions/workspace')
const { getRequestSession, getRequestPrincipal, forgetRequestIdentity } =
  await import('../request-session')
const { cacheDel, CACHE_KEYS } = await import('@/lib/server/cache')

let requestSeq = 0
function inRequest<T>(cookieToken: string | null, fn: () => Promise<T>): Promise<T> {
  currentHeaders = new Headers(
    cookieToken ? { cookie: `better-auth.session_token=${cookieToken}` } : {}
  )
  return runWithLogContext({ request_id: `req_${++requestSeq}` }, fn)
}

function addUser(opts: { token: string; userId: string; role: string; scope?: string }) {
  const now = new Date()
  sessionsByToken.set(opts.token, {
    session: {
      id: `sess_${opts.userId}`,
      token: opts.token,
      scope: opts.scope ?? 'dashboard',
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: opts.userId,
      email: `${opts.userId}@example.com`,
      name: opts.userId,
      image: null,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  })
  principalsByUser.set(opts.userId, {
    id: `principal_${opts.userId}`,
    userId: opts.userId,
    role: opts.role,
    type: 'user',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionsByToken.clear()
  principalsByUser.clear()
  portalVisibility = 'private'
  addUser({ token: 'tok_ada', userId: 'user_ada', role: 'admin' })
  addUser({ token: 'tok_bob', userId: 'user_bob', role: 'user' })
})

describe('one identity read per request', () => {
  it('resolves the session and principal once for every reader in the request', async () => {
    const results = await inRequest('tok_ada', async () => {
      // Concurrent, as SSR loaders run, then sequential stragglers.
      const [session, required, optional, access] = await Promise.all([
        getSession(),
        requireAuth(),
        getOptionalAuth(),
        resolvePortalAccessForRequest(),
      ])
      const role = await getCurrentUserRole()
      const again = await requireAuth({ permission: 'settings.manage' as never })
      return { session, required, optional, access, role, again }
    })

    expect(results.session?.user.id).toBe('user_ada')
    expect(results.required.principal.id).toBe('principal_user_ada')
    expect(results.optional?.principal.id).toBe('principal_user_ada')
    expect(results.access).toEqual({ granted: true, reason: 'team' })
    expect(results.role).toBe('admin')
    expect(results.again.permissions).toEqual(['settings.manage'])

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockPrincipalFindFirst).toHaveBeenCalledTimes(1)
    expect(mockPermissionsForPrincipal).toHaveBeenCalledTimes(1)
  })

  it('never carries an identity into another request', async () => {
    const first = await inRequest('tok_ada', () => getSession())
    const second = await inRequest('tok_bob', () => getSession())
    const anonymous = await inRequest(null, () => getSession())

    expect(first?.user.id).toBe('user_ada')
    expect(second?.user.id).toBe('user_bob')
    expect(anonymous).toBeNull()
    expect(mockGetSession).toHaveBeenCalledTimes(3)
  })

  it('memoizes nothing outside a request', async () => {
    currentHeaders = new Headers({ cookie: 'better-auth.session_token=tok_ada' })
    await getSession()
    await getSession()
    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })

  it('reads the session afresh after the request forgets its identity', async () => {
    const [before, after] = await inRequest('tok_ada', async () => {
      const before = await getRequestSession()
      // Sign-out in the same request: the session row is gone.
      sessionsByToken.delete('tok_ada')
      forgetRequestIdentity()
      return [before, await getRequestSession()] as const
    })
    expect(before?.user.id).toBe('user_ada')
    expect(after).toBeNull()
    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })

  it('reads a principal afresh after its cache key is deleted', async () => {
    const roles = await inRequest('tok_bob', async () => {
      const before = await requireAuth()
      // A role change busts the principal's cache key, as the factory does.
      principalsByUser.set('user_bob', { ...principalsByUser.get('user_bob')!, role: 'admin' })
      await cacheDel(CACHE_KEYS.PRINCIPAL_BY_USER('user_bob'))
      const after = await requireAuth()
      return [before.principal.role, after.principal.role]
    })
    expect(roles).toEqual(['user', 'admin'])
    expect(mockPrincipalFindFirst).toHaveBeenCalledTimes(2)
  })

  it('serves a lazily created principal to the rest of the request', async () => {
    principalsByUser.delete('user_bob')

    const ids = await inRequest('tok_bob', async () => {
      const [a, b] = await Promise.all([getOptionalAuth(), getOptionalAuth()])
      const c = await getRequestPrincipal('user_bob' as never)
      return [a?.principal.id, b?.principal.id, c?.id]
    })

    expect(ids).toEqual([
      'principal_new_user_bob',
      'principal_new_user_bob',
      'principal_new_user_bob',
    ])
    expect(mockEnsurePrincipal).toHaveBeenCalledTimes(1)
    // The request's own read, then the factory's read-first before it inserts.
    expect(mockPrincipalFindFirst).toHaveBeenCalledTimes(2)
  })

  it('keeps the audience of a widget session', async () => {
    addUser({ token: 'tok_widget', userId: 'user_w', role: 'admin', scope: 'widget' })
    const outcome = await inRequest('tok_widget', async () => {
      const optional = await getOptionalAuth()
      const required = await requireAuth().catch((err: Error) => err.message)
      return { optional, required }
    })
    expect(outcome.optional).toBeNull()
    expect(outcome.required).toMatch(/Widget sessions cannot access this resource/)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })
})

describe('portal gate', () => {
  it('answers a public portal without resolving the caller', async () => {
    portalVisibility = 'public'
    const decisions = await inRequest('tok_ada', async () => [
      await resolvePortalAccessForRequest(),
      await resolvePortalAccessForRequest(),
    ])
    expect(decisions).toEqual([
      { granted: true, reason: 'public' },
      { granted: true, reason: 'public' },
    ])
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockPrincipalFindFirst).not.toHaveBeenCalled()
    expect(mockGetPortalConfig).toHaveBeenCalledTimes(1)
  })

  it('still denies a signed-in end user on a private portal', async () => {
    const decision = await inRequest('tok_bob', () => resolvePortalAccessForRequest())
    expect(decision).toEqual({ granted: false, reason: 'unauthorized' })
  })
})
