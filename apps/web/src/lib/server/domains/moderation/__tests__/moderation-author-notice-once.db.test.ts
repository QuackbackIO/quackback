/**
 * Approving a held post or comment tells its author once.
 *
 * Approval also runs the real announce step (post.created / comment.created,
 * mentions, subscribers), and the author is subscribed to their own post. So
 * this suite resolves every event the approval wrote, through the real
 * notification resolver, and counts what reaches the author: one bell and one
 * email, from the decision event, and nothing from the announce events.
 *
 * Real database, rolled back per test; nothing is mocked on the way.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
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
  postComments,
  postSubscriptions,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { notificationResolver } from '@/lib/server/events/resolvers/notification.resolver'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { HookTarget } from '@/lib/server/events/hook-types'
import { approveComment, approvePost } from '../moderation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: events.eventId }).from(events).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'admin' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `U-${suffix()}`, email: `${role}-${suffix()}@example.com` })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return id
}

async function seedPost(author: PrincipalId, moderationState: 'pending' | 'published') {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Dark mode please',
      content: 'It hurts my eyes',
      principalId: author,
      moderationState,
    })
    .returning()
  // As createPost does: the author follows their own post.
  await testDb
    .insert(postSubscriptions)
    .values({ postId: post.id, principalId: author, reason: 'author' })
  return post.id as PostId
}

/** Every event written so far, as the relay hands each one to the sinks. */
/**
 * The events already written, by id. Postgres's now() is the transaction's
 * start, which is the test's start under this fixture, so a clock cut-off
 * would drop events on a slow run; the approval's events are the ids not
 * seen before it.
 */
async function eventIds(): Promise<Set<string>> {
  const rows = await testDb.select({ id: events.eventId }).from(events)
  return new Set(rows.map((r) => r.id))
}

async function allTargetsSince(before: Set<string>): Promise<HookTarget[]> {
  const rows = await testDb.select().from(events)
  const out: HookTarget[] = []
  for (const row of rows.filter((r) => !before.has(r.eventId))) {
    if (!notificationResolver.interestedIn(row.type)) continue
    const event = {
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
    out.push(...(await notificationResolver.resolve(event)))
  }
  return out
}

function reaching(targets: HookTarget[], who: PrincipalId) {
  const bells = targets.filter(
    (t) =>
      t.type === 'notification' &&
      (t.target as { principalIds: string[] }).principalIds.includes(who)
  )
  const emails = targets.filter(
    (t) => t.type === 'email' && (t.target as { principalId?: string }).principalId === who
  )
  return { bells, emails }
}

/** The event types written since `before`: proves the announce step ran for real. */
async function typesSince(before: Set<string>): Promise<string[]> {
  const rows = await testDb.select({ id: events.eventId, type: events.type }).from(events)
  return rows.filter((r) => !before.has(r.id)).map((r) => r.type)
}

const audit = (moderator: PrincipalId) => ({
  actor: { userId: null, role: 'admin', type: 'user' as const },
  principalId: moderator,
})

describe.skipIf(!fixture.available)('the author is told once', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())

  it('approving a held post sends its author one bell and one email', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const postId = await seedPost(author, 'pending')
    const since = await eventIds()

    await approvePost(postId, audit(moderator))
    expect(await typesSince(since)).toEqual(
      expect.arrayContaining(['post.created', 'post.approved'])
    )

    const { bells, emails } = reaching(await allTargetsSince(since), author)
    expect(bells).toHaveLength(1)
    expect(emails).toHaveLength(1)
    expect(bells[0].config).toMatchObject({ decision: 'approved', item: 'post' })
  })

  it('approving a held comment sends its author one bell and one email', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const postId = await seedPost(author, 'published')
    const [comment] = await testDb
      .insert(postComments)
      .values({ postId, principalId: author, content: 'Me too', moderationState: 'pending' })
      .returning()
    const since = await eventIds()

    await approveComment(comment.id, audit(moderator))
    expect(await typesSince(since)).toEqual(
      expect.arrayContaining(['comment.created', 'comment.approved'])
    )

    const { bells, emails } = reaching(await allTargetsSince(since), author)
    expect(bells).toHaveLength(1)
    expect(emails).toHaveLength(1)
    expect(bells[0].config).toMatchObject({ decision: 'approved', item: 'comment' })
  })
})
