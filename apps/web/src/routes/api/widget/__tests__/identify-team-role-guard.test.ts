/**
 * Verified-only contract on POST /api/widget/identify (GH issue #300).
 *
 * Background: the route mints a normal Better Auth session token and returns
 * it as a Bearer. The `bearer()` plugin is registered globally, so that token
 * satisfies `auth.api.getSession()` everywhere — including the admin-only
 * `requireAuth({ roles: ['admin'] })` path. An unverified id+email path would
 * turn "knowing an admin's email" into full account takeover, so identify
 * accepts ONLY an ssoToken signed by the customer's backend with the widget
 * secret. These tests are the regression pin: an id+email body must never
 * mint a session, no matter whose email it names.
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

describe('POST /api/widget/identify — the verified (ssoToken) path', () => {
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
