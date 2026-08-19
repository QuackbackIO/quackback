/**
 * Unit tests for GET /api/export/users (§I3): CSV export of the filtered
 * users/leads directory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockListPortalUsers: vi.fn(),
  mockGetTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/users/user.service', () => ({
  listPortalUsers: hoisted.mockListPortalUsers,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

import { handleExportUsers } from '../export.users'

function makeRequest(query: string = ''): Request {
  return { url: `https://app.test/api/export/users${query}` } as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({ settings: { slug: 'acme' } })
  hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: true } })
  hoisted.mockListPortalUsers.mockResolvedValue({
    items: [
      {
        principalId: 'principal_1',
        userId: 'user_1',
        name: 'Alice',
        email: 'alice@example.com',
        emailVerified: true,
        isLead: false,
        contactEmail: null,
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        lastSeenAt: new Date('2026-01-05T00:00:00Z'),
        postCount: 3,
        commentCount: 1,
        voteCount: 5,
        segments: [{ id: 'segment_1', name: 'VIP', color: '#fff', type: 'manual' }],
      },
    ],
    total: 1,
    hasMore: false,
  })
})

describe('GET /api/export/users', () => {
  it('returns 403 when the caller lacks people.view', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('forbidden'))
    const res = await handleExportUsers(makeRequest())
    expect(res.status).toBe(403)
    expect(hoisted.mockListPortalUsers).not.toHaveBeenCalled()
  })

  it('returns a CSV with the directory rows', async () => {
    const res = await handleExportUsers(makeRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    const body = await res.text()
    expect(body).toContain('name,email,verified,lifecycle,segments')
    expect(body).toContain('Alice')
    expect(body).toContain('alice@example.com')
    expect(body).toContain('VIP')
  })

  it('parses directory filters from the query string', async () => {
    await handleExportUsers(
      makeRequest('?search=alice&verified=true&lifecycle=leads&segmentIds=segment_1,segment_2')
    )

    expect(hoisted.mockListPortalUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'alice',
        verified: true,
        lifecycle: 'leads',
        segmentIds: ['segment_1', 'segment_2'],
      })
    )
  })

  it('never surfaces a synthetic anonymous email', async () => {
    hoisted.mockListPortalUsers.mockResolvedValue({
      items: [
        {
          principalId: 'principal_2',
          userId: 'user_2',
          name: 'Anon Lead',
          email: null,
          emailVerified: false,
          isLead: true,
          contactEmail: null,
          joinedAt: new Date('2026-01-01T00:00:00Z'),
          lastSeenAt: null,
          postCount: 0,
          commentCount: 0,
          voteCount: 0,
          segments: [],
        },
      ],
      total: 1,
      hasMore: false,
    })

    const res = await handleExportUsers(makeRequest())
    const body = await res.text()
    expect(body).toContain('"Anon Lead","",false,lead')
  })
})
