/**
 * Regression coverage for the sweep's circuit-breaker behaviour (#180).
 *
 * The original summary sweep had the same shape and burned ~318k LLM calls
 * because failed rows stayed stale and the `while(true)` query kept returning
 * the same batch. This file pins the merge sweep to the same protections:
 * an in-memory attempted set excluded at the DB level, and an abort after
 * consecutive zero-success batches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'

const mockFindCandidates = vi.fn()
const mockAssessCandidates = vi.fn()
const mockExpireStale = vi.fn()

vi.mock('../merge-search.service', () => ({
  findMergeCandidates: (...args: unknown[]) => mockFindCandidates(...args),
}))

vi.mock('../merge-assessment.service', () => ({
  assessMergeCandidates: (...args: unknown[]) => mockAssessCandidates(...args),
  determineDirection: vi.fn(() => ({ sourcePostId: '', targetPostId: '' })),
}))

vi.mock('../merge-suggestion.service', () => ({
  createMergeSuggestion: vi.fn(),
  expireStaleMergeSuggestions: (...args: unknown[]) => mockExpireStale(...args),
}))

const mockPostFindFirst = vi.fn()
const mockLimit = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      posts: {
        findFirst: (...args: unknown[]) => mockPostFindFirst(...args),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: (...args: unknown[]) => mockLimit(...args),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  },
  posts: {
    id: 'id',
    deletedAt: 'deleted_at',
    canonicalPostId: 'canonical_post_id',
    embedding: 'embedding',
    mergeCheckedAt: 'merge_checked_at',
    updatedAt: 'updated_at',
  },
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  notInArray: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-model',
}))

function makeStalePost(id: string): { id: PostId } {
  return { id: id as PostId }
}

describe('sweepMergeSuggestions — circuit breaker (#180)', () => {
  beforeEach(() => {
    // resetModules so the module-level _sweepInProgress guard from a prior
    // test (or a leaked timeout) doesn't early-return us.
    vi.resetModules()
    vi.clearAllMocks()
    // The sweep awaits a 500ms delay between every post. Real waiting bloats
    // the test runtime to seconds for a handful of batches; collapse the
    // setTimeout so the loop runs synchronously.
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      queueMicrotask(fn)
      return 0 as unknown as ReturnType<typeof global.setTimeout>
    }) as unknown as typeof global.setTimeout)
    mockExpireStale.mockResolvedValue(0)
    // Default: every post is a valid sweep candidate with an embedding so the
    // catch in _doSweep is reached via the LLM call, not the early bail.
    mockPostFindFirst.mockImplementation(async () => ({
      id: 'post_x' as PostId,
      title: 't',
      content: 'c',
      voteCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      deletedAt: null,
      canonicalPostId: null,
      embedding: [0.1, 0.2],
    }))
    mockFindCandidates.mockResolvedValue([
      {
        postId: 'post_cand' as PostId,
        title: 'cand',
        content: 'c',
        voteCount: 1,
        commentCount: 0,
        createdAt: new Date(),
        vectorScore: 0.9,
        ftsScore: 0.5,
        hybridScore: 0.92,
      },
    ])
  })

  it('terminates instead of looping forever when every assessment fails', async () => {
    // Simulate the #180 scenario: stale-post query returns the same two
    // failing rows every iteration (failed posts never get mergeCheckedAt
    // stamped, so the DB filter doesn't make progress on its own).
    const FAILING_BATCH = [makeStalePost('post_a'), makeStalePost('post_b')]
    // Safety wall: without the fix the sweep would call limit() forever.
    // With the fix, the attempted-set + circuit breaker must terminate in a
    // handful of iterations.
    const MAX_QUERY_CALLS = 6
    let calls = 0
    mockLimit.mockImplementation(() => {
      calls++
      if (calls > MAX_QUERY_CALLS) {
        throw new Error(
          `circuit breaker missing: sweep made ${calls} stale-post queries without terminating`
        )
      }
      return Promise.resolve(FAILING_BATCH)
    })

    mockAssessCandidates.mockRejectedValue(new Error('400 invalid model id'))

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    expect(calls).toBeLessThanOrEqual(MAX_QUERY_CALLS)
  })

  it('does not abort when the first batch makes progress (avoids false positives on slow runs)', async () => {
    // A batch that succeeds resets the empty-batch counter. The sweep should
    // only abort after CONSECUTIVE zero-success batches, not a single one.
    const POSTS_A = [makeStalePost('post_a'), makeStalePost('post_b')]
    const POSTS_B = [makeStalePost('post_c')]
    const queue: Array<typeof POSTS_A | []> = [POSTS_A, POSTS_B, []]
    mockLimit.mockImplementation(() => Promise.resolve(queue.shift() ?? []))

    // First batch: succeed. Second batch: succeed. Third query: empty → exit.
    mockAssessCandidates.mockResolvedValue([])

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    // Sanity: assessment ran for every post across both non-empty batches.
    expect(mockAssessCandidates).toHaveBeenCalledTimes(3)
  })
})
