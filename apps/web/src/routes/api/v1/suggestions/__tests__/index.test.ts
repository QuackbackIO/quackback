import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockGetPendingMergeSuggestions = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  getPendingMergeSuggestions: (...args: unknown[]) => mockGetPendingMergeSuggestions(...args),
}))

import { Route } from '../index'

type RouteOpts = { server: { handlers: { GET: (...args: unknown[]) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const VALID_POST_ID = 'post_01kqhxq697fvgat0fn8rr1r7ew' as PostId

describe('GET /api/v1/suggestions', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockGetPendingMergeSuggestions.mockReset()
    mockWithApiKeyAuth.mockResolvedValue({ principalId: 'principal_admin', role: 'admin' })
    mockGetPendingMergeSuggestions.mockResolvedValue({
      items: [
        {
          id: 'post_merge_sug_01kqhxq697fvgat0fn8rr1r7ex',
          status: 'pending',
          hybridScore: 0.91,
          llmConfidence: 0.88,
          llmReasoning: 'Same root cause',
          createdAt: new Date('2026-11-16T00:00:00.000Z'),
          updatedAt: new Date('2026-11-16T01:00:00.000Z'),
          sourcePost: {
            id: VALID_POST_ID,
            title: 'Source',
            content: 'Body',
            voteCount: 3,
            commentCount: 1,
            createdAt: new Date('2026-11-15T00:00:00.000Z'),
            boardName: 'Bugs',
            statusName: 'Open',
            statusColor: '#22c55e',
          },
          targetPost: {
            id: 'post_01kqhxq697fvgat0fn8rr1r7ey',
            title: 'Target',
            content: 'Body 2',
            voteCount: 5,
            commentCount: 2,
            createdAt: new Date('2026-11-14T00:00:00.000Z'),
            boardName: 'Bugs',
            statusName: 'Open',
            statusColor: '#22c55e',
          },
        },
      ],
      total: 3,
    })
  })

  it('requires SUGGESTION_VIEW permission and serializes dates and pagination total', async () => {
    const res = await GET({
      request: new Request(
        `http://test/api/v1/suggestions?sort=relevance&limit=25&postId=${VALID_POST_ID}`
      ),
    })

    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), {
      permission: PERMISSIONS.SUGGESTION_VIEW,
    })
    expect(mockGetPendingMergeSuggestions).toHaveBeenCalledWith({
      sort: 'relevance',
      limit: 25,
      postId: VALID_POST_ID,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].createdAt).toBe('2026-11-16T00:00:00.000Z')
    expect(body.data[0].sourcePost.createdAt).toBe('2026-11-15T00:00:00.000Z')
    expect(body.meta).toEqual({ pagination: { cursor: null, hasMore: true, total: 3 } })
  })

  it('rejects invalid sort, limit, and postId values with 400', async () => {
    for (const query of ['sort=bogus', 'limit=0', 'limit=abc', 'postId=not_a_post']) {
      const res = await GET({ request: new Request(`http://test/api/v1/suggestions?${query}`) })
      expect(res.status, query).toBe(400)
    }
    expect(mockGetPendingMergeSuggestions).not.toHaveBeenCalled()
  })
})
