/**
 * A comment that @-mentions someone tells them, from the one place a comment
 * becomes visible (dispatchCommentCreatedEvent: at create when it is not
 * held, and on approval). The author is never told about themselves, only
 * people can be mentioned, and a private comment reaches teammates only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostCommentId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

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
vi.mock('@/lib/server/integrations/message-utils', () => ({
  buildPostUrl: (_links: unknown, boardSlug: string, postId: string) =>
    `https://acme.example/b/${boardSlug}/posts/${postId}`,
}))

import { dispatchCommentCreatedEvent } from '../comment.announce'

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

async function publish(author: PrincipalId, contentJson: unknown, isPrivate = false) {
  const commentId = createId('post_comment') as PostCommentId
  await dispatchCommentCreatedEvent(
    { principalId: author, displayName: 'Bea' },
    { id: commentId, content: 'Over to someone', isPrivate, contentJson },
    post
  )
  return commentId
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
    const author = await person('user')
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
    const author = await person('user')
    const teammate = await person('member')
    sectionOrigins.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(publish(author, mentionDoc(teammate))).resolves.toBeDefined()

    expect(dispatched.commentCreated).toHaveBeenCalledOnce()
    expect(dispatched.commentMentioned).not.toHaveBeenCalled()
  })
})
