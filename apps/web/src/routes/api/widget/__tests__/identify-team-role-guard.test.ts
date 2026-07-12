/**
 * Staff/admin identity guard on POST /api/widget/identify (GH audit A7#3).
 *
 * Background: the route mints a normal Better Auth session token and returns
 * it as a Bearer. The `bearer()` plugin is registered globally, so that token
 * satisfies `auth.api.getSession()` everywhere — including the admin-only
 * `requireAuth({ roles: ['admin'] })` path. A signed ssoToken vouches for
 * email/sub matching, but never for role: if a customer's signed identity
 * collides with an existing teammate account, identify must refuse rather
 * than hand an embedding origin a session that can authorize dashboard/admin
 * APIs. Also covers: an id+email body must never mint a session regardless
 * of whose email it names (GH issue #300), and the atomic (SQL, not
 * JS-merge) metadata write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateSet = vi.fn()
const mockVerifyJWT = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
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
      return {
        set: (s: unknown) => {
          mockUpdateSet(s)
          return { where: async () => undefined }
        },
      }
    },
  },
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
  verifyHS256JWT: (...args: unknown[]) => mockVerifyJWT(...args),
}))

vi.mock('@/lib/server/domains/users/user.attributes', () => ({
  validateAndCoerceAttributes: vi.fn(async () => ({ valid: {}, removals: [], errors: [] })),
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
  mockUpdateSet.mockReset()
  mockVerifyJWT.mockReturnValue({ sub: 'sso-user', email: 'sso@acme.com', name: 'SSO User' })
})

describe('POST /api/widget/identify — rejects any body without a signed ssoToken', () => {
  it('rejects an id+email body naming an admin email and mints nothing', async () => {
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

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('VALIDATION_ERROR')
    // No session (or any row) may be created on the rejection path.
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    // The rejection happens at the schema boundary, before any user lookup.
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('rejects an id+email body naming a member email', async () => {
    const res = await postIdentify({ id: 'attacker-supplied', email: 'member@acme.com' })
    expect(res.status).toBe(400)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects an id+email body even for a plain customer email', async () => {
    // Unverified identify is gone entirely — not just team-guarded.
    const res = await postIdentify({ id: 'foo', email: 'customer@acme.com' })
    expect(res.status).toBe(400)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a first-time email with no existing user', async () => {
    mockUserFindFirst.mockResolvedValue(null)
    const res = await postIdentify({ id: 'new-id', email: 'first-time@acme.com' })
    expect(res.status).toBe(400)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/widget/identify — staff/admin identity guard (A7#3)', () => {
  it('refuses to mint a session when the ssoToken resolves to an admin principal', async () => {
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

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('IDENTITY_NOT_ALLOWED')
    // No session row, and no mutation of the staff user's row either.
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refuses to mint a session when the ssoToken resolves to a member (teammate) principal', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_member_sso',
      email: 'sso@acme.com',
      name: 'SSO Member',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(403)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/widget/identify — the verified (ssoToken) path for a portal identity', () => {
  it('succeeds and mints a session when the resolved principal is a plain portal user', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_portal_sso',
      email: 'sso@acme.com',
      name: 'Portal User',
      image: null,
      imageKey: null,
      metadata: null,
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_portal_sso', role: 'user' })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionToken?: string }
    expect(body.sessionToken).toBeTruthy()
  })

  it('succeeds for a brand-new identity (no existing user, no existing principal)', async () => {
    mockUserFindFirst.mockResolvedValue(null)
    mockPrincipalFindFirst.mockResolvedValue(null)

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
  })
})

describe('POST /api/widget/identify — atomic metadata write', () => {
  it('merges custom attributes via an atomic SQL expression, not a JS read/merge/write', async () => {
    mockVerifyJWT.mockReturnValue({
      sub: 'sso-user',
      email: 'sso@acme.com',
      name: 'SSO User',
      plan: 'enterprise',
    })
    const { validateAndCoerceAttributes } =
      await import('@/lib/server/domains/users/user.attributes')
    vi.mocked(validateAndCoerceAttributes).mockResolvedValueOnce({
      valid: { plan: 'enterprise' },
      removals: [],
      errors: [],
    })
    mockUserFindFirst.mockResolvedValue({
      id: 'user_attrs_sso',
      email: 'sso@acme.com',
      name: 'SSO User',
      image: null,
      imageKey: null,
      metadata: '{"existing":"value"}',
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_attrs_sso', role: 'user' })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    expect(mockUpdateSet).toHaveBeenCalled()
    const setArgs = mockUpdateSet.mock.calls.map((c) => c[0] as Record<string, unknown>)
    const updateWithMetadata = setArgs.find((s) => 'metadata' in s)
    expect(updateWithMetadata).toBeDefined()
    // The mocked `sql` tag returns only the literal text preceding the first
    // interpolation — a plain JSON string (what a JS mergeMetadata call would
    // produce) would never match this, so this pins the write to the atomic
    // coalesce/jsonb SQL expression instead of a read-then-write.
    expect(updateWithMetadata?.metadata).toBe('((coalesce(nullif(')
  })
})
