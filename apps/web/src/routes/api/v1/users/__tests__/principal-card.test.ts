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

// Target-row lookup uses a join, so we mock the select-builder chain alongside
// the findFirst the caller-lookup still uses.
const selectChain = {
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: vi.fn() },
    },
    select: vi.fn(() => selectChain),
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
  user: {
    id: 'id',
    image: 'image',
    imageKey: 'image_key',
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

type TargetRow = {
  id: string
  displayName: string | null
  avatarUrl: string | null
  avatarKey: string | null
  role: string
  createdAt: Date
  userImage: string | null
  userImageKey: string | null
}

function mockTargetRow(row: TargetRow | null): void {
  selectChain.limit.mockResolvedValueOnce(row ? [row] : [])
}

describe('GET /api/v1/users/:principalId/card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectChain.from.mockReturnValue(selectChain)
    selectChain.leftJoin.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
  })

  it('returns 200 + body for an existing principal', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    const targetCreatedAt = new Date('2024-01-15T08:00:00.000Z')
    mockTargetRow({
      id: 'principal_jane',
      displayName: 'Jane Doe',
      avatarUrl: null,
      avatarKey: 'avatars/jane.png',
      role: 'admin',
      createdAt: targetCreatedAt,
      userImage: null,
      userImageKey: null,
    })

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

  it('falls back to user.imageKey when both principal avatar columns are null', async () => {
    // Mirrors the production data anomaly: a principal whose own avatar
    // columns drifted from the source-of-truth user record (e.g. created
    // before syncPrincipalProfile was wired into every upload path).
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    mockTargetRow({
      id: 'principal_stale',
      displayName: 'Stale Principal',
      avatarUrl: null,
      avatarKey: null,
      role: 'user',
      createdAt: new Date('2024-01-15T08:00:00.000Z'),
      userImage: null,
      userImageKey: 'avatars/2026/03/stale-key.png',
    })

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_stale' },
    })

    const body = await res.json()
    expect(body.avatarUrl).toBe('https://cdn.example.com/avatars/2026/03/stale-key.png')
  })

  it('falls back to user.image when no avatar key is anywhere', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    mockTargetRow({
      id: 'principal_oauth',
      displayName: 'OAuth User',
      avatarUrl: null,
      avatarKey: null,
      role: 'user',
      createdAt: new Date('2024-01-15T08:00:00.000Z'),
      userImage: 'https://lh3.googleusercontent.com/a/abc',
      userImageKey: null,
    })

    const res = await handlePrincipalCard({
      request: makeRequest(),
      params: { principalId: 'principal_oauth' },
    })

    const body = await res.json()
    expect(body.avatarUrl).toBe('https://lh3.googleusercontent.com/a/abc')
  })

  it('returns 404 when the principal does not exist', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(callerPrincipal)
    mockTargetRow(null)

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
    // Caller-lookup happened but the target select was never invoked.
    expect(db.query.principal.findFirst).toHaveBeenCalledTimes(1)
    expect(selectChain.limit).not.toHaveBeenCalled()
  })
})
