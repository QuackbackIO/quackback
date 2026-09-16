/**
 * POST /api/widget/identify — verified identify for any matching account,
 * including teammates, plus the GH #300 / A6 pins.
 *
 * Widget sessions are audience-scoped (`scope=widget`) and cannot satisfy
 * team/permission gates, so a signed ssoToken that resolves to an admin or
 * member mints a customer widget session instead of 403ing. The stored
 * teammate role is left alone; dashboard profile fields are not overwritten
 * from the host-app JWT. Also covers: an id+email body must never mint a
 * session regardless of whose email it names (GH issue #300), and the
 * atomic (SQL, not JS-merge) metadata write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockInsert = vi.fn()
const mockInsertValues = vi.fn()
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
        values: (v: unknown) => {
          mockInsertValues(v)
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

vi.mock('@/lib/server/auth/country-capture', () => ({
  captureCountryFromHeaders: () => 'US',
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
  mockInsertValues.mockReset()
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

describe('POST /api/widget/identify — teammate identities mint a widget session', () => {
  it('mints a widget session when the ssoToken resolves to an admin principal', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_admin_sso',
      email: 'sso@acme.com',
      name: 'Dashboard Admin Name',
      image: null,
      imageKey: null,
      metadata: null,
      externalId: 'sso-user',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_admin_sso',
      role: 'admin',
      type: 'user',
    })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionToken?: string; canPortalHandoff?: boolean }
    expect(body.sessionToken).toBeTruthy()
    expect(body.canPortalHandoff).toBe(false)
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ scope: 'widget' }))
  })

  it('mints a widget session when the ssoToken resolves to a member principal', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_member_sso',
      email: 'sso@acme.com',
      name: 'Dashboard Member Name',
      image: null,
      imageKey: null,
      metadata: null,
      externalId: 'sso-user',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_member_sso',
      role: 'member',
      type: 'user',
    })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    expect(mockInsert).toHaveBeenCalled()
  })

  it('does not reuse a portal-scoped session for a teammate identify', async () => {
    mockUserFindFirst.mockResolvedValue({
      id: 'user_admin_sso',
      email: 'sso@acme.com',
      name: 'Dashboard Admin Name',
      image: null,
      imageKey: null,
      metadata: null,
      externalId: 'sso-user',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_admin_sso',
      role: 'admin',
      type: 'user',
    })
    mockSessionFindFirst.mockResolvedValue({
      id: 'sess_portal',
      token: 'portal-token',
      scope: 'portal',
    })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionToken?: string }
    expect(body.sessionToken).not.toBe('portal-token')
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ scope: 'widget' }))
  })

  it('does not overwrite a teammate dashboard profile from the host-app JWT', async () => {
    mockVerifyJWT.mockReturnValue({
      sub: 'sso-user',
      email: 'sso@acme.com',
      name: 'Host App Name',
      avatarUrl: 'https://host.example/avatar.png',
    })
    mockUserFindFirst.mockResolvedValue({
      id: 'user_admin_sso',
      email: 'sso@acme.com',
      name: 'Dashboard Admin Name',
      image: 'https://dashboard.example/avatar.png',
      imageKey: null,
      metadata: '{"plan":"internal"}',
      country: 'GB',
      externalId: 'dashboard-subject',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_admin_sso',
      role: 'admin',
      type: 'user',
    })

    const res = await postIdentify({ ssoToken: 'jwt.token.here' })

    expect(res.status).toBe(200)
    const setArgs = mockUpdateSet.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(setArgs.some((s) => 'name' in s)).toBe(false)
    expect(setArgs.some((s) => 'image' in s)).toBe(false)
    expect(setArgs.some((s) => 'metadata' in s)).toBe(false)
    expect(setArgs.some((s) => 'email' in s)).toBe(false)
    expect(setArgs.some((s) => 'country' in s)).toBe(false)
    expect(setArgs.some((s) => 'externalId' in s)).toBe(false)
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
    const body = (await res.json()) as { sessionToken?: string; canPortalHandoff?: boolean }
    expect(body.sessionToken).toBeTruthy()
    expect(body.canPortalHandoff).toBe(true)
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
