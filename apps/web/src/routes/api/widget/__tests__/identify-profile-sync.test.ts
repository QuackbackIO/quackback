/**
 * POST /api/widget/identify — the host app's name and avatar reach the
 * principal, not only the user row.
 *
 * Post and comment author labels read `principal.display_name`, and
 * `ensurePrincipalForUser` returns an existing principal unchanged, so a
 * rename in the host app used to reach the user row only. The REST identify
 * (user.identify.ts) already syncs the principal; the widget identify now does
 * the same for an ordinary portal user, within the REST identify's bounds,
 * and writes nothing when the principal already matches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockVerifyJWT = vi.fn()
const mockUpdatePrincipalFields = vi.fn(async (..._args: unknown[]) => ({ cacheKeysToBust: [] }))
const updates: Array<{ table: unknown; set: Record<string, unknown> }> = []
const inserts: Array<{ table: unknown; values: unknown }> = []

/** Like Drizzle: a `columns` selection returns only those columns. */
function selectColumns(row: unknown, args: unknown): unknown {
  const columns = (args as { columns?: Record<string, boolean> } | undefined)?.columns
  if (!row || !columns) return row
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).filter(([key]) => columns[key])
  )
}

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
      principal: {
        findFirst: async (args: unknown) => selectColumns(await mockPrincipalFindFirst(args), args),
      },
      segments: { findFirst: vi.fn() },
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values })
        const chain = {
          returning: async () => [{ id: 'newly_inserted' }],
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: () => chain,
        }
        return chain
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set })
        return { where: async () => undefined }
      },
    }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn((parts: TemplateStringsArray) => parts.raw[0]),
}))

vi.mock('@/lib/server/domains/principals/principal.factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/principal.factory')>()),
  updatePrincipalFields: (...args: unknown[]) => mockUpdatePrincipalFields(...args),
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
  EXTERNAL_ID_KEY: '_externalUserId',
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  addMember: vi.fn(async () => undefined),
  reconcileWidgetMemberships: vi.fn(async () => undefined),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn((kind: string) => `${kind}_generated`),
}))

import { principal, user } from '@/lib/server/db'
import { Route } from '../identify'

type RouteOpts = {
  server: {
    handlers: {
      POST: (args: { request: Request }) => Promise<Response>
    }
  }
}
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

function postIdentify(): Promise<Response> {
  return POST({
    request: new Request('http://test/api/widget/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ssoToken: 'jwt.token.here' }),
    }),
  })
}

const OLD_AVATAR = 'https://host.example/old.png'
const NEW_AVATAR = 'https://host.example/new.png'
const GUARDS = { guards: { onlyType: 'user', onlyRole: 'user' } }

function claims(extra: Record<string, unknown> = {}) {
  mockVerifyJWT.mockReturnValue({ sub: 'host-user', email: 'person@acme.com', ...extra })
}

/** A returning portal user; the principal mirrors the user row unless told otherwise. */
function returningUser(
  opts: {
    userName?: string
    image?: string | null
    principalName?: string
    principalAvatar?: string | null
    role?: string
    type?: string
  } = {}
) {
  const userName = opts.userName ?? 'Old Name'
  const image = opts.image === undefined ? OLD_AVATAR : opts.image
  mockUserFindFirst.mockResolvedValue({
    id: 'user_portal',
    email: 'person@acme.com',
    name: userName,
    image,
    imageKey: null,
    metadata: null,
    emailVerified: true,
    country: 'US',
    externalId: 'host-user',
  })
  mockPrincipalFindFirst.mockResolvedValue({
    id: 'principal_portal',
    userId: 'user_portal',
    role: opts.role ?? 'user',
    type: opts.type ?? 'user',
    displayName: opts.principalName ?? userName,
    avatarUrl: opts.principalAvatar === undefined ? image : opts.principalAvatar,
  })
}

const userSets = () => updates.filter((u) => u.table === user).map((u) => u.set)
const principalWrites = () => [
  ...mockUpdatePrincipalFields.mock.calls,
  ...updates.filter((u) => u.table === principal).map((u) => [u.set]),
]

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  inserts.length = 0
  mockUserFindFirst.mockReset()
  mockPrincipalFindFirst.mockReset()
  mockSessionFindFirst.mockResolvedValue(null)
})

describe('POST /api/widget/identify — the principal follows the host profile', () => {
  it('renames the user row and the principal together, guarded to an ordinary portal user', async () => {
    claims({ name: 'New Name' })
    returningUser()

    const res = await postIdentify()

    expect(res.status).toBe(200)
    expect(userSets()).toContainEqual(expect.objectContaining({ name: 'New Name' }))
    expect(mockUpdatePrincipalFields.mock.calls).toEqual([
      [{ userId: 'user_portal' }, { displayName: 'New Name' }, GUARDS],
    ])
    const body = (await res.json()) as { user?: { name?: string } }
    expect(body.user?.name).toBe('New Name')
  })

  it('heals a principal name that drifted from an already-renamed user row', async () => {
    claims({ name: 'New Name' })
    returningUser({ userName: 'New Name', principalName: 'Verified user' })

    await postIdentify()

    expect(userSets().some((s) => 'name' in s)).toBe(false)
    expect(mockUpdatePrincipalFields.mock.calls).toEqual([
      [{ userId: 'user_portal' }, { displayName: 'New Name' }, GUARDS],
    ])
  })

  it('moves a changed avatar to the user row and the principal', async () => {
    claims({ name: 'Old Name', avatarURL: NEW_AVATAR })
    returningUser()

    const res = await postIdentify()

    expect(userSets()).toContainEqual(expect.objectContaining({ image: NEW_AVATAR }))
    expect(mockUpdatePrincipalFields.mock.calls).toEqual([
      [{ userId: 'user_portal' }, { avatarUrl: NEW_AVATAR }, GUARDS],
    ])
    const body = (await res.json()) as { user?: { avatarUrl?: string | null } }
    expect(body.user?.avatarUrl).toBe(NEW_AVATAR)
  })

  it('heals a principal avatar that drifted from the user row', async () => {
    claims({ name: 'Old Name', avatarUrl: NEW_AVATAR })
    returningUser({ image: NEW_AVATAR, principalAvatar: OLD_AVATAR })

    await postIdentify()

    expect(userSets().some((s) => 'image' in s)).toBe(false)
    expect(mockUpdatePrincipalFields.mock.calls).toEqual([
      [{ userId: 'user_portal' }, { avatarUrl: NEW_AVATAR }, GUARDS],
    ])
  })

  it('writes nothing to the principal when it already matches (no extra write on the hot path)', async () => {
    claims({ name: 'Old Name', avatarURL: OLD_AVATAR })
    returningUser()

    const res = await postIdentify()

    expect(res.status).toBe(200)
    expect(principalWrites()).toEqual([])
  })
})

describe('POST /api/widget/identify — what the principal sync leaves alone', () => {
  it('a teammate principal', async () => {
    claims({ name: 'Host App Name', avatarURL: NEW_AVATAR })
    returningUser({ userName: 'Dashboard Name', role: 'admin' })

    await postIdentify()

    expect(principalWrites()).toEqual([])
  })

  it.each([['support'], ['service'], ['anonymous']])('a %s principal', async (type) => {
    claims({ name: 'New Name', avatarURL: NEW_AVATAR })
    returningUser({ type })

    await postIdentify()

    expect(principalWrites()).toEqual([])
  })

  it('a user with no principal yet (ensurePrincipalForUser creates it from the updated row)', async () => {
    claims({ name: 'New Name' })
    returningUser()
    mockPrincipalFindFirst.mockResolvedValue(null)

    const res = await postIdentify()

    expect(res.status).toBe(200)
    expect(principalWrites()).toEqual([])
    expect(inserts).toContainEqual({
      table: principal,
      values: expect.objectContaining({ userId: 'user_portal', displayName: 'New Name' }),
    })
  })

  it('a name or avatar outside the REST identify bounds', async () => {
    claims({ name: 'x'.repeat(201), avatarURL: 'not a url' })
    returningUser()

    await postIdentify()

    expect(principalWrites()).toEqual([])
  })

  it.each([
    ['absent', {}],
    ['null', { avatarURL: null }],
    ['an empty string', { avatarURL: '' }],
  ])('the picture when the avatar claim is %s', async (_label, extra) => {
    claims({ name: 'Old Name', ...extra })
    returningUser()

    await postIdentify()

    expect(userSets().some((s) => 'image' in s)).toBe(false)
    expect(principalWrites()).toEqual([])
  })
})
