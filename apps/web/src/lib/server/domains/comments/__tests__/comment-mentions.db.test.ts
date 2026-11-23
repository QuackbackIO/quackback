/**
 * A comment that @-mentions someone tells them, from the one place a comment
 * becomes visible (dispatchCommentCreatedEvent: at create when it is not
 * held, and on approval). The author is never told about themselves, only
 * people can be mentioned, and a private comment reaches teammates only.
 *
 * Only a teammate's, an API key's or an integration's text tells anyone: a
 * customer gets no mention picker, so a mention node in their comment is a
 * crafted request (the same rule posts follow). The writer is who sent the
 * text, so a comment filed for a customer through the API still tells.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostCommentId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'
import type { Actor } from '@/lib/server/policy/types'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const dispatched = vi.hoisted(() => ({
  commentCreated: vi.fn(async () => {}),
  commentMentioned: vi.fn(async (_actor: unknown, _input: Record<string, unknown>) => {}),
}))
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  dispatchCommentCreated: dispatched.commentCreated,
  dispatchCommentMentioned: dispatched.commentMentioned,
}))
const sectionOrigins = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, string>> => ({ feedback: 'https://acme.example' }))
)
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: sectionOrigins,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: async () => DEFAULT_PORTAL_CONFIG,
}))
vi.mock('@/lib/server/integrations/message-utils', () => ({
  buildPostUrl: (_links: unknown, boardSlug: string, postId: string) =>
    `https://acme.example/b/${boardSlug}/posts/${postId}`,
}))

import { announcePublishedComment, dispatchCommentCreatedEvent } from '../comment.announce'
import { createComment } from '../comment.service'
import { userEditComment } from '../comment.permissions'

const fixture = await createDbTestFixture()

async function person(
  role: 'admin' | 'member' | 'user',
  type: 'user' | 'anonymous' | 'service' = 'user'
): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  const userId = createId('user')
  await testDb.insert(user).values({ id: userId, name: 'P', email: `${userId}@acme.example` })
  await testDb.insert(principal).values({ id, userId, role, type, createdAt: new Date() })
  return id
}

function mentionDoc(...ids: string[]) {
  return {
    type: 'doc',
    content: ids.map((id) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Over to ' },
        { type: 'mention', attrs: { id, label: 'someone' } },
      ],
    })),
  }
}

const post = {
  id: createId('post') as PostId,
  title: 'Dark mode',
  boardId: createId('board'),
  boardSlug: 'ideas',
}

async function publish(
  author: PrincipalId,
  contentJson: unknown,
  isPrivate = false,
  writer?: PrincipalId
) {
  const commentId = createId('post_comment') as PostCommentId
  await dispatchCommentCreatedEvent(
    { principalId: author, displayName: 'Bea' },
    { id: commentId, content: 'Over to someone', isPrivate, contentJson },
    post,
    writer
  )
  return commentId
}

/** A real post on a real board, for createComment. */
async function seededPost(): Promise<PostId> {
  const boardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Ideas', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  const postId = createId('post') as PostId
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    title: 'Dark mode',
    content: '',
    principalId: await person('member'),
  })
  return postId
}

function actorFor(
  principalId: PrincipalId,
  role: 'admin' | 'member' | 'user',
  principalType: 'user' | 'service' = 'user'
): Actor {
  return {
    principalId,
    role,
    principalType,
    segmentIds: new Set(),
    permissions: new Set(resolveActorPermissions(role)),
  }
}

const mentionedIds = () =>
  dispatched.commentMentioned.mock.calls.map(([, input]) => input.mentionedPrincipalId).sort()

describe.skipIf(!fixture.available)('comment mentions (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('tells each person a published comment mentions, linking to the comment', async () => {
    const author = await person('member')
    const teammate = await person('member')
    const customer = await person('user')

    const commentId = await publish(author, mentionDoc(teammate, customer))

    expect(mentionedIds()).toEqual([teammate, customer].sort())
    expect(dispatched.commentMentioned.mock.calls[0][1]).toMatchObject({
      postId: post.id,
      postTitle: 'Dark mode',
      postUrl: `https://acme.example/b/ideas/posts/${post.id}`,
      boardId: post.boardId,
      commentId,
      isPrivate: false,
      mentioningPrincipalId: author,
      excerpt: 'Over to',
    })
  })

  it('never tells the author about their own mention, nor anyone who is not a person', async () => {
    const author = await person('member')
    const anonymous = await person('user', 'anonymous')
    const service = await person('member', 'service')

    await publish(author, mentionDoc(author, anonymous, service, 'principal_not_an_id'))

    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })

  it('a private comment reaches teammates only', async () => {
    const author = await person('admin')
    const teammate = await person('member')
    const customer = await person('user')

    await publish(author, mentionDoc(teammate, customer), true)

    expect(mentionedIds()).toEqual([teammate])
    expect(dispatched.commentMentioned.mock.calls[0][1]).toMatchObject({ isPrivate: true })
  })

  it('a failure telling people never fails the comment, which is already saved', async () => {
    const author = await person('member')
    const teammate = await person('member')
    sectionOrigins.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(publish(author, mentionDoc(teammate))).resolves.toBeDefined()

    expect(dispatched.commentCreated).toHaveBeenCalledOnce()
    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })

  it("a customer's or anonymous visitor's mention tells nobody, on publish or approval", async () => {
    const teammate = await person('member')
    const other = await person('user')

    await publish(await person('user'), mentionDoc(teammate, other))
    await publish(await person('user', 'anonymous'), mentionDoc(teammate, other))

    expect(dispatched.commentCreated).toHaveBeenCalledTimes(2)
    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })

  it('a comment an API key or teammate wrote for a customer still tells', async () => {
    const customer = await person('user')
    const teammate = await person('member')
    const apiKey = await person('member', 'service')

    await publish(customer, mentionDoc(teammate), false, apiKey)
    expect(mentionedIds()).toEqual([teammate])
    expect(dispatched.commentMentioned.mock.calls[0][1]).toMatchObject({
      mentioningPrincipalId: customer,
    })

    vi.clearAllMocks()
    const admin = await person('admin')
    await publish(customer, mentionDoc(teammate), false, admin)
    expect(mentionedIds()).toEqual([teammate])
  })

  it('a customer writing as someone else still tells nobody', async () => {
    const teammate = await person('member')
    await publish(await person('member'), mentionDoc(teammate), false, await person('user'))
    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })

  describe('createComment', () => {
    it("a customer's comment with a crafted mention tells nobody", async () => {
      const postId = await seededPost()
      const customer = await person('user')
      const teammate = await person('member')

      await createComment(
        { postId, content: 'Over to someone', contentJson: mentionDoc(teammate) as never },
        { principalId: customer, role: 'user' },
        actorFor(customer, 'user')
      )

      expect(dispatched.commentCreated).toHaveBeenCalledOnce()
      expect(dispatched.commentMentioned).not.toHaveBeenCalled()
    })

    it("a teammate's comment tells the people it mentions", async () => {
      const postId = await seededPost()
      const writer = await person('member')
      const customer = await person('user')

      await createComment(
        { postId, content: 'Over to someone', contentJson: mentionDoc(customer) as never },
        { principalId: writer, role: 'member' },
        actorFor(writer, 'member')
      )

      expect(mentionedIds()).toEqual([customer])
    })

    it('an API key filing a comment for a customer (authorPrincipalId) tells', async () => {
      const postId = await seededPost()
      const customer = await person('user')
      const apiKey = await person('admin', 'service')
      const teammate = await person('member')

      await createComment(
        { postId, content: 'Over to someone', contentJson: mentionDoc(teammate) as never },
        { principalId: customer, role: 'user' },
        actorFor(apiKey, 'admin', 'service')
      )

      expect(mentionedIds()).toEqual([teammate])
      expect(dispatched.commentMentioned.mock.calls[0][1]).toMatchObject({
        mentioningPrincipalId: customer,
      })
    })

    it("a customer's edit adding a mention tells nobody", async () => {
      const postId = await seededPost()
      const customer = await person('user')
      const teammate = await person('member')
      const { comment } = await createComment(
        { postId, content: 'First thoughts' },
        { principalId: customer, role: 'user' },
        actorFor(customer, 'user')
      )
      vi.clearAllMocks()

      await userEditComment(
        comment.id,
        'Over to someone',
        { principalId: customer, role: 'user' },
        { contentJson: mentionDoc(teammate) as never }
      )

      expect(dispatched.commentMentioned).not.toHaveBeenCalled()
    })
  })

  it("approving a customer's held comment with a mention tells nobody", async () => {
    const postId = await seededPost()
    const customer = await person('user')
    const teammate = await person('member')
    const [held] = await testDb
      .insert(postComments)
      .values({
        postId,
        principalId: customer,
        content: 'Over to someone',
        contentJson: mentionDoc(teammate) as never,
        moderationState: 'published',
      })
      .returning({ id: postComments.id })

    await announcePublishedComment(held.id as PostCommentId)

    expect(dispatched.commentCreated).toHaveBeenCalledOnce()
    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })
})
