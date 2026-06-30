/**
 * Team-role guard on POST /api/widget/identify.
 *
 * Background: the route mints a normal Better Auth session token and returns
 * it as a Bearer. The `bearer()` plugin is registered globally, so that token
 * satisfies `auth.api.getSession()` everywhere — including the admin-only
 * `requireAuth({ roles: ['admin'] })` path. Without this guard, "knowing an
 * admin's email" in unverified mode escalates to full admin takeover.
 *
 * The guard refuses to mint sessions for emails whose principal is admin or
 * member. Customer-tier collisions (role='user') remain allowed — that's the
 * documented unverified trust model. The verified (ssoToken) path is exempt:
 * HMAC vouches for the claim.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      session: { findFirst: (...args: unknown[]) => mockSessionFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      segments: { findFirst: vi.fn() },
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return {
        values: () => {
          const chain = {
            returning: async () => [{ id: 'newly_inserted' }],
            onConflictDoUpdate: async () => undefined,
            onConflictDoNothing: () => chain,
          }
          return chain
        },
      }
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args)
      return { set: () => ({ where: async () => undefined }) }
    },
  },
  user: {},
  session: {},
  principal: {},
  segments: {},
  widgetIdentifiedSession: { sessionId: 'session_id' },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn((parts: TemplateStringsArray) => parts.raw[0]),
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(async () => ({ enabled: true, identifyVerification: false })),
  getWidgetSecret: vi.fn(async () => 'secret'),
}))

vi.mock('@/lib/server/domains/posts/post.public', () => ({
  getAllUserVotedPostIds: vi.fn(async () => new Set()),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn(() => null),
}))

vi.mock('@/lib/server/auth/identify-merge', () => ({
  resolveAndMergeAnonymousToken: vi.fn(),
}))

vi.mock('@/lib/server/widget/identity-token', () => ({
  verifyHS256JWT: vi.fn(() => ({ sub: 'sso-user', email: 'sso@acme.com', name: 'SSO User' })),
}))

vi.mock('@/lib/server/domains/users/user.attributes', () => ({
  validateAndCoerceAttributes: vi.fn(async () => ({ valid: {}, removals: [], errors: [] })),
  mergeMetadata: vi.fn(() => null),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  addMember: vi.fn(async () => undefined),
  reconcileWidgetMemberships: vi.fn(async () => undefined),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn((kind: string) => `${kind}_generated`),
}))

import { Route } from '../identify'

type RouteOpts = {
  server: {
    handlers: {
      POST: (args: { request: Request }) => Promise<Response>
    }
  }
}
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function postIdentify(body: Record<string, unknown>): Promise<Response> {
  return POST({
    request: new Request('http://test/api/widget/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUserFindFirst.mockReset()
  mockPrincipalFindFirst.mockReset()
  mockSessionFindFirst.mockResolvedValue(null)
  mockInsert.mockReset()
  mockUpdate.mockReset()
})

describe('POST /api/widget/identify — team-role guard (unverified path)', () => {
  it('refuses with 403 IDENTITY_LOCKED when the email belongs to an admin', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_admin',
      email: 'admin@acme.com',
      name: 'Admin',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })

    const res = await postIdentify({ id: 'attacker-supplied', email: 'admin@acme.com' })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('IDENTITY_LOCKED')
    // No session should be minted on the rejection path.
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refuses with 403 IDENTITY_LOCKED when the email belongs to a member', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_member',
      email: 'member@acme.com',
      name: 'Member',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })

    const res = await postIdentify({ id: 'attacker-supplied', email: 'member@acme.com' })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('IDENTITY_LOCKED')
  })

  it('allows the unverified path when the email belongs to a role=user principal', async () => {
    // Customer-tier collision: documented trust model accepts this.
    mockUserFindFirst.mockResolvedValue({
      id: 'user_customer',
      email: 'customer@acme.com',
      name: 'Customer',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })

    const res = await postIdentify({ id: 'foo', email: 'customer@acme.com' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionToken?: string }
    expect(body.sessionToken).toBeTypeOf('string')
  })

  it('allows the unverified path when no user exists for the email yet', async () => {
    // No collision — first-time identify creates a fresh user + principal.
    mockUserFindFirst.mockResolvedValue(null)
    // After the user insert, the principal lookup also returns null and is created.
    mockPrincipalFindFirst.mockResolvedValue(null)

    const res = await postIdentify({ id: 'new-id', email: 'first-time@acme.com' })

    expect(res.status).toBe(200)
  })
})

describe('POST /api/widget/identify — team-role guard does NOT apply to verified path', () => {
  it('allows ssoToken identify even when the email backs an admin', async () => {
    // verifyHS256JWT mock above returns sso@acme.com; we map an admin to it.
    mockUserFindFirst.mockResolvedValue({
      id: 'user_admin_sso',
      email: 'sso@acme.com',
      name: 'SSO Admin',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    // HMAC vouches for this claim — the guard must NOT engage.
    expect(res.status).toBe(200)
  })
})
