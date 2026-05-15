/**
 * Principal-card endpoint feeds the @-mention hover overlay. Mock-based:
 * mirrors the harness used by the suggest endpoint test (which also reads
 * `auth.api.getSession` + `db.query.principal.findFirst`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSession, mockPrincipal } from '../../../__tests__/upload-fixtures'

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
  },
  principal: {
    id: 'id',
    userId: 'user_id',
    type: 'type',
    role: 'role',
    displayName: 'display_name',
    avatarUrl: 'avatar_url',
    avatarKey: 'avatar_key',
    createdAt: 'created_at',
  },
  eq: vi.fn((col, val) => ({ _eq: [col, val] })),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null | undefined) =>
    key ? `https://cdn.example.com/${key}` : null,
}))

import { auth } from '@/lib/server/auth'
import { db } from '@/lib/server/db'
import { handlePrincipalCard } from '../$principalId.card'

const callerPrincipal = mockPrincipal({ type: 'user' })
const anonymousCaller = mockPrincipal({ type: 'anonymous' })

const identifiedSession = mockSession({
  user: { id: 'user_member', email: 'member@example.com', name: 'Member' },
})

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/users/principal_jane/card', { method: 'GET' })
}

describe('GET /api/v1/users/:principalId/card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 + body for an existing principal', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    // First findFirst: caller lookup
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    // Second findFirst: target principal row
    const targetCreatedAt = new Date('2024-01-15T08:00:00.000Z')
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce({
      id: 'principal_jane',
      displayName: 'Jane Doe',
      avatarUrl: null,
      avatarKey: 'avatars/jane.png',
      role: 'admin',
      createdAt: targetCreatedAt,
    } as never)

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_jane' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      principalId: 'principal_jane',
      displayName: 'Jane Doe',
      // avatarKey wins over avatarUrl when present
      avatarUrl: 'https://cdn.example.com/avatars/jane.png',
      role: 'admin',
      joinedAt: targetCreatedAt.toISOString(),
    })
  })

  it('returns 404 when the principal does not exist', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(undefined as never)

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_missing' },
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 when no session cookie is present', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_jane' },
    })

    expect(res.status).toBe(403)
    expect(db.query.principal.findFirst).not.toHaveBeenCalled()
  })

  it('returns 403 for an anonymous session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(anonymousCaller)

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_jane' },
    })

    expect(res.status).toBe(403)
    // Only the caller-lookup query happened; the target lookup was never reached.
    expect(db.query.principal.findFirst).toHaveBeenCalledTimes(1)
  })
})
