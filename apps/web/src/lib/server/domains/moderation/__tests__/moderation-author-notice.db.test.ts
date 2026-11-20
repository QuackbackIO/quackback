/**
 * The author of a held post or comment hears what the team decided.
 *
 * Approving or rejecting a held item records one event (`post.approved`,
 * `post.rejected`, `comment.approved`, `comment.rejected`), and that event
 * reaches its author as an email and a bell, under their notification
 * preferences. A rejected post no longer exists, so its notice links nowhere.
 * A teammate moderating their own item, an anonymous author and a muted author
 * get no email.
 *
 * Real database (rolled back per test); the targets come from the real
 * notification resolver, so the event, its payload and the recipient rules are
 * all exercised together.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// The announce side effects (webhooks, mentions, AI) are not what this suite
// is about; they keep their own tests.
vi.mock('@/lib/server/domains/posts/post.announce', () => ({
  announcePublishedPost: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/comments/comment.announce', () => ({
  announcePublishedComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  }),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  events,
  eq,
  desc,
  notificationPreferences,
  postComments,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { notificationResolver } from '@/lib/server/events/resolvers/notification.resolver'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { HookTarget } from '@/lib/server/events/hook-types'
import { approveComment, approvePost, rejectComment, rejectPost } from '../moderation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: events.eventId }).from(events).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(
  role: 'admin' | 'user',
  type: 'user' | 'anonymous' = 'user'
): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${role}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  await testDb.insert(principal).values({ id, userId, role, type, createdAt: new Date() })
  return { id, email }
}

async function seedBoard() {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
    .returning()
  return board
}

async function seedHeldPost(author: PrincipalId) {
  const board = await seedBoard()
  const [row] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Dark mode please',
      content: 'It hurts my eyes',
      principalId: author,
      moderationState: 'pending',
    })
    .returning()
  return { postId: row.id as PostId, board }
}

async function seedHeldComment(author: PrincipalId) {
  const board = await seedBoard()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'Dark mode please', content: 'x', principalId: author })
    .returning()
  const [comment] = await testDb
    .insert(postComments)
    .values({
      postId: post.id,
      principalId: author,
      content: 'Me too',
      moderationState: 'pending',
    })
    .returning()
  return { postId: post.id as PostId, commentId: comment.id as PostCommentId, board }
}

function auditFor(moderator: PrincipalId) {
  return {
    actor: { userId: null, role: 'admin', type: 'user' as const },
    principalId: moderator,
  }
}

/** The last event of `type` written to the outbox, as the relay hands it on. */
async function lastEvent(type: string): Promise<DomainEvent | undefined> {
  const [row] = await testDb
    .select()
    .from(events)
    .where(eq(events.type, type))
    .orderBy(desc(events.occurredAt))
    .limit(1)
  if (!row) return undefined
  return {
    eventId: row.eventId,
    seq: 0n,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType,
    actorId: row.actorId,
    payload: row.payload,
    context: row.context ?? { depth: 0 },
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt,
  } as unknown as DomainEvent
}

async function targetsFor(type: string): Promise<HookTarget[]> {
  const event = await lastEvent(type)
  expect(event, `${type} event recorded`).toBeDefined()
  expect(notificationResolver.interestedIn(type)).toBe(true)
  return notificationResolver.resolve(event!)
}

const emailsOf = (targets: HookTarget[]) => targets.filter((t) => t.type === 'email')
const bellsOf = (targets: HookTarget[]) => targets.filter((t) => t.type === 'notification')

describe.skipIf(!fixture.available)('moderation decision reaches the author', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('approving a held post emails and belles its author with a link to the post', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const { postId, board } = await seedHeldPost(author.id)

    await approvePost(postId, auditFor(moderator.id))

    const targets = await targetsFor('post.approved')
    const [email] = emailsOf(targets)
    expect(email).toBeDefined()
    expect((email.target as { email: string }).email).toBe(author.email)
    expect(email.config).toMatchObject({
      decision: 'approved',
      item: 'post',
      postTitle: 'Dark mode please',
      postUrl: expect.stringContaining(`/b/${board.slug}/posts/${postId}`),
    })
    expect((email.target as { unsubscribeUrl: string }).unsubscribeUrl).toContain('/unsubscribe?')
    const [bell] = bellsOf(targets)
    expect((bell.target as { principalIds: string[] }).principalIds).toEqual([author.id])
  })

  it('rejecting a held post tells its author, with no link to the removed post', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const { postId } = await seedHeldPost(author.id)

    await rejectPost(postId, 'spam', auditFor(moderator.id))

    const targets = await targetsFor('post.rejected')
    const [email] = emailsOf(targets)
    expect((email.target as { email: string }).email).toBe(author.email)
    expect(email.config).toMatchObject({ decision: 'rejected', item: 'post' })
    expect((email.config as { postUrl?: string }).postUrl).toBeUndefined()
    // The moderator's reason is for the audit trail, not the author.
    expect(JSON.stringify(email.config)).not.toContain('spam')
    const [bell] = bellsOf(targets)
    expect((bell.target as { principalIds: string[] }).principalIds).toEqual([author.id])
    expect((bell.config as { postId?: string }).postId).toBeUndefined()
  })

  it('approving a held comment tells its author, linking to the comment', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const { commentId } = await seedHeldComment(author.id)

    await approveComment(commentId, auditFor(moderator.id))

    const targets = await targetsFor('comment.approved')
    const [email] = emailsOf(targets)
    expect((email.target as { email: string }).email).toBe(author.email)
    expect(email.config).toMatchObject({ decision: 'approved', item: 'comment' })
    expect((email.config as { postUrl: string }).postUrl).toContain(`#comment-${commentId}`)
    expect(bellsOf(targets)).toHaveLength(1)
  })

  it('rejecting a held comment tells its author', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const { commentId } = await seedHeldComment(author.id)

    await rejectComment(commentId, undefined, auditFor(moderator.id))

    const targets = await targetsFor('comment.rejected')
    const [email] = emailsOf(targets)
    expect((email.target as { email: string }).email).toBe(author.email)
    expect(email.config).toMatchObject({ decision: 'rejected', item: 'comment' })
    expect(bellsOf(targets)).toHaveLength(1)
  })

  it('honours the author turning these emails off, and keeps the bell', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    await testDb.insert(notificationPreferences).values({
      principalId: author.id,
      matrix: { post_moderated: { email: false } },
    })
    const { postId } = await seedHeldPost(author.id)

    await approvePost(postId, auditFor(moderator.id))

    const targets = await targetsFor('post.approved')
    expect(emailsOf(targets)).toHaveLength(0)
    expect(bellsOf(targets)).toHaveLength(1)
  })

  it('says nothing to a teammate who moderates their own post', async () => {
    const teammate = await seedPerson('admin')
    const { postId } = await seedHeldPost(teammate.id)

    await approvePost(postId, auditFor(teammate.id))

    expect(await targetsFor('post.approved')).toEqual([])
  })

  it('says nothing to an anonymous author, who has no inbox', async () => {
    const author = await seedPerson('user', 'anonymous')
    const moderator = await seedPerson('admin')
    const { postId } = await seedHeldPost(author.id)

    await rejectPost(postId, undefined, auditFor(moderator.id))

    expect(await targetsFor('post.rejected')).toEqual([])
  })
})
