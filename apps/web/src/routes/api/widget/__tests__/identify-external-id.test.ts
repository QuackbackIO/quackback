/**
 * External-identity resolution on POST /api/widget/identify.
 *
 * The verified ssoToken path keys identity on the JWT `sub` (a stable host-app
 * id) so a visitor is recognized on a new device even after an email change.
 * The unverified id+email path must NEVER read or write `external_id` — the
 * client controls `sub` there, so keying on it would allow account takeover.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const insertValues = vi.fn()
const updateSet = vi.fn()
const mockVerifyJWT = vi.fn()

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
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v)
        const chain = {
          returning: async () => [{ id: 'inserted' }],
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: () => chain,
        }
        return chain
      },
    }),
    update: () => ({
      set: (s: unknown) => {
        updateSet(s)
        return { where: async () => undefined }
      },
    }),
  },
  user: { externalId: 'external_id' },
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
  verifyHS256JWT: (...args: unknown[]) => mockVerifyJWT(...args),
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
  server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } }
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

/** The values handed to the `user` insert (the call carrying an `email`). */
function userInsertValues(): Record<string, unknown> | undefined {
  const call = insertValues.mock.calls.find(
    (c) => c[0] && typeof c[0] === 'object' && 'email' in (c[0] as object)
  )
  return call?.[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSessionFindFirst.mockResolvedValue(null)
})

describe('POST /api/widget/identify — external_id resolution (verified path)', () => {
  it('creates a new user stamped with the verified sub as external_id', async () => {
    mockVerifyJWT.mockReturnValue({ sub: 'sub_alice', email: 'alice@acme.com', name: 'Alice' })
    mockUserFindFirst.mockResolvedValue(null) // no external_id match, no email match
    mockPrincipalFindFirst.mockResolvedValue(null)

    const res = await postIdentify({ ssoToken: 'jwt' })

    expect(res.status).toBe(200)
    expect(userInsertValues()?.externalId).toBe('sub_alice')
  })

  it('resolves a returning sub to the same user and adopts the new email', async () => {
    mockVerifyJWT.mockReturnValue({ sub: 'sub_bob', email: 'bob-new@acme.com', name: 'Bob' })
    mockUserFindFirst
      // external_id lookup hits the existing user (email has since changed)…
      .mockResolvedValueOnce({
        id: 'user_bob',
        email: 'bob-old@acme.com',
        externalId: 'sub_bob',
        name: 'Bob',
        image: null,
        metadata: null,
      })
      // …clash check: no other row already holds the new email.
      .mockResolvedValueOnce(null)
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_bob', role: 'user' })

    const res = await postIdentify({ ssoToken: 'jwt' })

    expect(res.status).toBe(200)
    // No new user row — resolved by the stable subject, not the email.
    expect(userInsertValues()).toBeUndefined()
    // sub is authoritative: the changed email is adopted onto the same account.
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ email: 'bob-new@acme.com' }))
  })

  it('backfills external_id when the user is first matched by email', async () => {
    mockVerifyJWT.mockReturnValue({ sub: 'sub_carol', email: 'carol@acme.com', name: 'Carol' })
    mockUserFindFirst
      .mockResolvedValueOnce(null) // external_id miss
      .mockResolvedValueOnce({
        id: 'user_carol',
        email: 'carol@acme.com',
        externalId: null,
        name: 'Carol',
        image: null,
        metadata: null,
      }) // email hit
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_carol', role: 'user' })

    const res = await postIdentify({ ssoToken: 'jwt' })

    expect(res.status).toBe(200)
    expect(userInsertValues()).toBeUndefined()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'sub_carol' }))
  })
})

describe('POST /api/widget/identify — no unverified path exists (GH issue #300)', () => {
  it('rejects an id+email body outright; no lookups, no user row, no external_id', async () => {
    const res = await postIdentify({ id: 'client_sub', email: 'dan@acme.com' })

    expect(res.status).toBe(400)
    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(userInsertValues()).toBeUndefined()
  })
})
