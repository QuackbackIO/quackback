/**
 * @-mention typeahead endpoint. Privacy-critical:
 *   - only matches `lower(displayName)` (never email)
 *   - prefix-only (no substring)
 *   - filters out anonymous + service principals
 *   - rate-limited per session (60/min)
 *
 * Mock-based: we don't exercise the real Postgres functional index, just
 * assert that the query predicate is shaped correctly and the response
 * filters the rows the DB returns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSession, mockPrincipal } from '../../../__tests__/upload-fixtures'

const mockSelect = vi.fn()
const mockIncrementBucket = vi.fn()

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: vi.fn() },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
  principal: {
    id: 'id',
    userId: 'user_id',
    type: 'type',
    role: 'role',
    displayName: 'display_name',
    avatarUrl: 'avatar_url',
    avatarKey: 'avatar_key',
  },
  eq: vi.fn((col, val) => ({ _eq: [col, val] })),
  and: vi.fn((...args) => ({ _and: args })),
  inArray: vi.fn((col, vals) => ({ _inArray: [col, vals] })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings, values } }),
    {}
  ),
}))

vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null | undefined) =>
    key ? `https://cdn.example.com/${key}` : null,
}))

import { auth } from '@/lib/server/auth'
import { db } from '@/lib/server/db'
import { handleMentionSuggest } from '../suggest'

const userPrincipal = mockPrincipal({ type: 'user' })
const anonymousPrincipal = mockPrincipal({ type: 'anonymous' })
const servicePrincipal = mockPrincipal({ type: 'service' })

const identifiedSession = mockSession({
  user: { id: 'user_member', email: 'member@example.com', name: 'Member' },
})

function makeRequest(q: string | null): Request {
  const url =
    q === null
      ? 'http://localhost/api/v1/mentions/suggest'
      : `http://localhost/api/v1/mentions/suggest?q=${encodeURIComponent(q)}`
  return new Request(url, { method: 'GET' })
}

/**
 * Build a chain stub for `db.select({...}).from(...).where(...).limit(...)`.
 * Returns the rows on the final `.limit()` call, and captures the predicate
 * passed to `.where()` so tests can assert on its shape.
 */
interface QueryChainCapture {
  whereArg?: unknown
}
function makeChain(rows: unknown[], capture: QueryChainCapture) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn((arg: unknown) => {
        capture.whereArg = arg
        return {
          limit: vi.fn().mockResolvedValue(rows),
        }
      }),
    }),
  }
}

describe('GET /api/v1/mentions/suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: rate limit allows (first request in window).
    mockIncrementBucket.mockResolvedValue({ count: 1 })
  })

  it('returns matching prefix rows for an authenticated session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(userPrincipal)
    const capture: QueryChainCapture = {}
    const rows = [
      {
        id: 'principal_jane',
        displayName: 'Jane Doe',
        avatarUrl: 'https://avatars/jane.png',
        avatarKey: null,
        role: 'admin',
      },
      {
        id: 'principal_jake',
        displayName: 'Jake Smith',
        avatarUrl: null,
        avatarKey: 'avatars/jake.png',
        role: 'member',
      },
    ]
    mockSelect.mockReturnValueOnce(makeChain(rows, capture))

    const res = await handleMentionSuggest({ request: makeRequest('Ja') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{
      principalId: string
      displayName: string
      avatarUrl: string | null
      role: string
    }>
    expect(body).toEqual([
      {
        principalId: 'principal_jane',
        displayName: 'Jane Doe',
        avatarUrl: 'https://avatars/jane.png',
        role: 'admin',
      },
      {
        principalId: 'principal_jake',
        displayName: 'Jake Smith',
        // avatarKey wins over avatarUrl when present
        avatarUrl: 'https://cdn.example.com/avatars/jake.png',
        role: 'member',
      },
    ])
  })

  it('returns 403 for an anonymous session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(anonymousPrincipal)
    const res = await handleMentionSuggest({ request: makeRequest('jane') })
    expect(res.status).toBe(403)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns 403 when no session cookie is present', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handleMentionSuggest({ request: makeRequest('jane') })
    expect(res.status).toBe(403)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('rejects when the caller is a service principal', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(servicePrincipal)
    const res = await handleMentionSuggest({ request: makeRequest('zen') })
    expect(res.status).toBe(403)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns [] for an empty query without hitting the DB', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(userPrincipal)
    const res = await handleMentionSuggest({ request: makeRequest('   ') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('queries displayName with a prefix LIKE (not substring) and never queries email', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(userPrincipal)
    const capture: QueryChainCapture = {}
    mockSelect.mockReturnValueOnce(makeChain([], capture))

    await handleMentionSuggest({ request: makeRequest('JaNe') })

    // The selected columns must not include email.
    const selectArg = mockSelect.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(selectArg)).toEqual(
      expect.arrayContaining(['id', 'displayName', 'avatarUrl', 'avatarKey', 'role'])
    )
    expect(Object.keys(selectArg)).not.toContain('email')

    // Walk the predicate to find the sql template. It must be a prefix LIKE
    // (`q%`) against lower(display_name), with the input lowercased.
    function* walk(node: unknown): Generator<unknown> {
      if (node == null || typeof node !== 'object') return
      yield node
      for (const v of Object.values(node as Record<string, unknown>)) {
        if (Array.isArray(v)) for (const item of v) yield* walk(item)
        else yield* walk(v)
      }
    }
    let sawLowerDisplayName = false
    let sawPrefixValue = false
    for (const node of walk(capture.whereArg)) {
      const sqlNode = (node as { _sql?: { strings: ArrayLike<string>; values: unknown[] } })._sql
      if (!sqlNode) continue
      const text = Array.from(sqlNode.strings).join(' ')
      if (text.includes('lower(') && text.toUpperCase().includes('LIKE')) {
        sawLowerDisplayName = true
      }
      for (const v of sqlNode.values) {
        if (typeof v === 'string' && v === 'jane%') sawPrefixValue = true
        // Substring (`%jane%`) must NEVER appear.
        if (typeof v === 'string' && v.startsWith('%')) {
          throw new Error(`prefix LIKE expected, got substring: ${v}`)
        }
      }
    }
    expect(sawLowerDisplayName).toBe(true)
    expect(sawPrefixValue).toBe(true)
  })

  it('returns 429 once the rate-limit bucket is exceeded', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(userPrincipal)
    mockIncrementBucket.mockResolvedValueOnce({ count: 61 })
    const res = await handleMentionSuggest({ request: makeRequest('jane') })
    expect(res.status).toBe(429)
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
