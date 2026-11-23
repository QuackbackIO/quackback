/**
 * The post detail's first page of comments holds the pinned comment even when
 * it is older than the newest roots the page carries, whole: with its replies
 * and reactions, as a thread comment in the same cache the reply and reaction
 * updates patch. A later page that holds it again is de-duplicated when the
 * client appends it. Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postCommentReactions, postComments, posts, principal } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy'
import { addReplyToTree } from '@/lib/client/utils/comment-tree-helpers'
import { appendCommentPage } from '@/lib/client/mutations/load-more-comments'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { getPublicPostDetail } = await import('../post.public.detail')

const fixture = await createDbTestFixture()
const MINUTE = 60_000

async function seedPrincipal(role: 'admin' | 'user'): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id, role, type: 'user', displayName: role, createdAt: new Date() })
  return id
}

async function comment(
  postId: PostId,
  by: PrincipalId,
  content: string,
  minutesAgo: number,
  parentId?: PostCommentId
): Promise<PostCommentId> {
  const id = createId('post_comment') as PostCommentId
  await testDb.insert(postComments).values({
    id,
    postId,
    principalId: by,
    content,
    parentId: parentId ?? null,
    isTeamMember: true,
    createdAt: new Date(Date.now() - minutesAgo * MINUTE),
  })
  return id
}

function ids(list: PublicCommentView[]): string[] {
  return list.map((c) => c.id)
}

describe.skipIf(!fixture.available)('the pinned comment on the post detail (real DB)', () => {
  let postId: PostId
  let pinned: PostCommentId
  let reply: PostCommentId

  beforeEach(async () => {
    await fixture.begin()
    const admin = await seedPrincipal('admin')
    const reader = await seedPrincipal('user')
    const boardId = createId('board') as BoardId
    await testDb.insert(boards).values({
      id: boardId,
      name: 'Ideas',
      slug: `pinned-${Math.random().toString(36).slice(2, 10)}`,
      access: DEFAULT_BOARD_ACCESS,
    })
    postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: 'Pinned thread', content: '', principalId: admin })
    // The answer is the oldest root; 32 newer roots push it off the first page.
    pinned = await comment(postId, admin, 'The answer', 200)
    reply = await comment(postId, reader, 'Thanks, that worked', 190, pinned)
    for (let i = 0; i < 32; i++) await comment(postId, reader, `Chatter ${i}`, 100 - i)
    await testDb
      .insert(postCommentReactions)
      .values({ commentId: pinned, principalId: reader, emoji: '👍' })
    await testDb.update(posts).set({ pinnedCommentId: pinned })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('carries the pinned comment on the first page, with its replies and reactions', async () => {
    const detail = await getPublicPostDetail(postId, ANONYMOUS_ACTOR, { limit: 30 })
    expect(detail?.commentsHasMore).toBe(true)
    const root = detail!.comments.find((c) => c.id === pinned)
    expect(root).toBeDefined()
    expect(root!.replies.map((r) => r.id)).toEqual([reply])
    expect(root!.reactions).toEqual([expect.objectContaining({ emoji: '👍', count: 1 })])
    expect(detail!.pinnedCommentId).toBe(pinned)
    // The page's own 30 roots plus the pinned one.
    expect(detail!.comments).toHaveLength(31)
  })

  it('lets a new reply attach to the pinned comment in the cached thread', async () => {
    const detail = await getPublicPostDetail(postId, ANONYMOUS_ACTOR, { limit: 30 })
    const optimistic = {
      ...detail!.comments[0],
      id: 'comment_new' as PostCommentId,
      parentId: pinned,
      content: 'A follow-up',
      replies: [],
      reactions: [],
    }
    const next = addReplyToTree(detail!.comments as PublicCommentView[], pinned, optimistic)
    const root = next.find((c) => c.id === pinned)!
    expect(ids(root.replies)).toEqual([reply, 'comment_new'])
  })

  it('shows it once after the next page, which also holds it, is appended', async () => {
    const first = await getPublicPostDetail(postId, ANONYMOUS_ACTOR, { limit: 30 })
    const second = await getPublicPostDetail(postId, ANONYMOUS_ACTOR, {
      limit: 30,
      cursor: first!.commentsNextCursor,
    })
    expect(ids(second!.comments as PublicCommentView[])).toContain(pinned)
    const merged = appendCommentPage(
      { comments: first!.comments as PublicCommentView[] },
      { comments: second!.comments as PublicCommentView[] }
    )
    expect(ids(merged.comments).filter((id) => id === pinned)).toHaveLength(1)
    expect(merged.comments).toHaveLength(33)
  })
})
