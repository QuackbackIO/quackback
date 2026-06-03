/**
 * `listViewableMergedSourceIds` — the per-actor allowlist of post ids
 * that have been merged into a given canonical and whose board the
 * actor is entitled to view.
 *
 * Without this gate, the post-detail SQL's `WHERE c.post_id IN (...
 * UNION ALL SELECT id FROM posts WHERE canonical_post_id = $1)` would
 * union in comments from every merged source, including ones from
 * team-only / segment-restricted boards.
 *
 * The audience + moderation gate is now applied IN SQL via
 * `postViewFilter(actor)`. These tests assert the helper:
 *   - composes the right join + where shape (postViewFilter included)
 *   - returns whichever ids the SQL produced (with no extra JS filtering)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId, type PrincipalId, type SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'

const mockWhere = vi.fn()
const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere })
const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin })
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

const mockPostViewFilter = vi.fn((_actor: Actor) => ({ kind: 'postViewFilter' }))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
  },
  posts: {
    id: 'posts.id',
    boardId: 'posts.board_id',
    canonicalPostId: 'posts.canonical_post_id',
    deletedAt: 'posts.deleted_at',
  },
  boards: { id: 'boards.id', access: 'boards.access', deletedAt: 'boards.deleted_at' },
  eq: vi.fn((col, val) => ({ eq: [col, val] })),
  and: vi.fn((...parts) => ({ and: parts })),
  isNull: vi.fn((col) => ({ isNull: col })),
}))

vi.mock('@/lib/server/policy', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    postViewFilter: (...a: unknown[]) => mockPostViewFilter(...(a as [Actor])),
  }
})

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    principalId: 'prn_test' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set<SegmentId>(),
    ...overrides,
  }
}

const CANON_ID = generateId('post')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listViewableMergedSourceIds', () => {
  it('passes the resolved actor to postViewFilter (SQL-side audience gate)', async () => {
    mockWhere.mockResolvedValueOnce([])
    const { listViewableMergedSourceIds } = await import('../post.public.detail')
    const a = actor({ role: 'admin' })

    await listViewableMergedSourceIds(CANON_ID, a)

    expect(mockPostViewFilter).toHaveBeenCalledWith(a)
  })

  it('returns the ids the SQL returned, in order', async () => {
    mockWhere.mockResolvedValueOnce([
      { id: 'post_src_a' },
      { id: 'post_src_b' },
      { id: 'post_src_c' },
    ])
    const { listViewableMergedSourceIds } = await import('../post.public.detail')
    const ids = await listViewableMergedSourceIds(CANON_ID, actor())
    expect(ids).toEqual(['post_src_a', 'post_src_b', 'post_src_c'])
  })

  it('returns an empty array when the SQL returns no rows', async () => {
    mockWhere.mockResolvedValueOnce([])
    const { listViewableMergedSourceIds } = await import('../post.public.detail')
    const ids = await listViewableMergedSourceIds(CANON_ID, actor())
    expect(ids).toEqual([])
  })

  it('always joins boards so the audience filter has a column to reference', async () => {
    mockWhere.mockResolvedValueOnce([])
    const { listViewableMergedSourceIds } = await import('../post.public.detail')
    await listViewableMergedSourceIds(CANON_ID, actor())
    expect(mockInnerJoin).toHaveBeenCalled()
  })
})
