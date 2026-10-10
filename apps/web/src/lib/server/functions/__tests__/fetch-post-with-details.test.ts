/**
 * fetchPostWithDetails, the admin post modal's detail read. Pins that the
 * post, its comment page, the viewer's vote, the posts merged into it and any
 * requested panels are read side by side, and that the policy actor (a
 * segment lookup) is resolved only for a post merged into another, the one
 * case that shows a merge banner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data?: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: schema ? schema.parse(args?.data) : args?.data })
    }
    fn.validator = (s: { parse: (v: unknown) => unknown }) => {
      schema = s
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const auth = {
  principal: { id: 'principal_admin' },
  permissions: [PERMISSIONS.POST_VIEW_PRIVATE],
}
const policyActorFromAuth = vi.fn(async () => ({ principalId: 'principal_admin' }))
vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: vi.fn(async () => auth),
  policyActorFromAuth: (...args: unknown[]) => policyActorFromAuth(...(args as [])),
}))

// Each read resolves only when the test releases it, so the test can see
// which reads are in flight at the same time.
const started: string[] = []
const releases = new Map<string, () => void>()
function held<T>(name: string, value: T) {
  return () => {
    started.push(name)
    return new Promise<T>((resolve) => releases.set(name, () => resolve(value)))
  }
}
const post = { canonicalPostId: null as PostId | null }
vi.mock('@/lib/server/domains/posts/post.query', () => ({
  getPostWithDetails: () =>
    held('post', {
      id: 'post_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      eta: null,
      summaryUpdatedAt: null,
      pinnedComment: null,
      mergedAt: null,
      ...post,
    })(),
  getPaginatedCommentsWithReplies: held('comments', {
    comments: [],
    hasMore: false,
    nextCursor: null,
    totalRootCount: 0,
  }),
}))
vi.mock('@/lib/server/domains/posts/post.public.utils', () => ({
  hasUserVoted: held('voted', false),
}))
const getPostMergeInfo = vi.fn(async () => null)
vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  getMergedPosts: held('merged', []),
  getPostMergeInfo: (...args: unknown[]) => getPostMergeInfo(...(args as [])),
}))

const { fetchPostWithDetails } = await import('../posts')

async function settle(call: Promise<unknown>) {
  // Release every read, however late it starts, until the call resolves.
  let done = false
  void call.finally(() => (done = true))
  while (!done) {
    for (const release of releases.values()) release()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return call
}

beforeEach(() => {
  started.length = 0
  releases.clear()
  policyActorFromAuth.mockClear()
  getPostMergeInfo.mockClear()
  post.canonicalPostId = null
})

describe('fetchPostWithDetails', () => {
  it('starts every read at once', async () => {
    const call = fetchPostWithDetails({ data: { id: 'post_1' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(started.sort()).toEqual(['comments', 'merged', 'post', 'voted'])
    await settle(call)
  })

  it('skips the policy actor for a post not merged into another', async () => {
    await settle(fetchPostWithDetails({ data: { id: 'post_1' } }))

    expect(policyActorFromAuth).not.toHaveBeenCalled()
    expect(getPostMergeInfo).not.toHaveBeenCalled()
  })

  it('resolves merge info as the admin for a post merged into another', async () => {
    post.canonicalPostId = 'post_canonical' as PostId

    await settle(fetchPostWithDetails({ data: { id: 'post_1' } }))

    expect(policyActorFromAuth).toHaveBeenCalledWith(auth)
    expect(getPostMergeInfo).toHaveBeenCalledWith('post_1', { principalId: 'principal_admin' })
  })
})
