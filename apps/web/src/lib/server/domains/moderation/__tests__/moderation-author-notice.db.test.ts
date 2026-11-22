/**
 * The author of a held post or comment hears what the team decided.
 *
 * Approving or rejecting a held item records one event (`post.approved`,
 * `post.rejected`, `comment.approved`, `comment.rejected`), and that event
 * reaches its author as an email and a bell, under their notification
 * preferences. A rejected post no longer exists, so its notice links nowhere.
 * A teammate moderating their own item, an anonymous author and a muted author
 * get no email. Nor does the author of an item held for longer than the
 * backlog window, or anyone when the workspace turned these emails off; the
 * bell still goes in both cases.
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

// Guarded as the real `db` is: a decision made in a transaction must not touch
// the shared handle inside it, not even to build its guard subqueries.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).guardedTestDb,
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
  settings,
  user,
} from '@/lib/server/db'
import {
  DEFAULT_PORTAL_CONFIG,
  type ModerationDefault,
} from '@/lib/server/domains/settings/settings.types'
import { MODERATION_DECISION_EMAIL_MAX_AGE_MS } from '@/lib/server/events/targets'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { notificationResolver } from '@/lib/server/events/resolvers/notification.resolver'
import type { DomainEvent } from '@/lib/server/events/envelope'
import type { HookTarget } from '@/lib/server/events/hook-types'
import { approveComment, approvePost, rejectComment, rejectPost } from '../moderation.service'
import { updatePortalConfig } from '@/lib/server/domains/settings/settings.service'
import { moderationAuditFromApiAuth } from '@/routes/api/v1/moderation/-audit'
import {
  DELETED_USER_PRINCIPAL_ID,
  ensureDeletedUserPrincipal,
} from '@/lib/server/domains/principals/principal-reattribute'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: events.eventId }).from(events).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(
  role: 'admin' | 'user',
  type: 'user' | 'anonymous' = 'user',
  testOwnerPrincipalId: PrincipalId | null = null
): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${role}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  await testDb
    .insert(principal)
    .values({ id, userId, role, type, testOwnerPrincipalId, createdAt: new Date() })
  return { id, email }
}

async function seedBoard(access = DEFAULT_BOARD_ACCESS) {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access })
    .returning()
  return board
}

async function seedHeldPost(
  author: PrincipalId,
  access = DEFAULT_BOARD_ACCESS,
  createdAt = new Date()
) {
  const board = await seedBoard(access)
  const [row] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Dark mode please',
      content: 'It hurts my eyes',
      principalId: author,
      moderationState: 'pending',
      createdAt,
    })
    .returning()
  return { postId: row.id as PostId, board }
}

async function seedHeldComment(author: PrincipalId, createdAt = new Date()) {
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
      createdAt,
    })
    .returning()
  return { postId: post.id as PostId, commentId: comment.id as PostCommentId, board }
}

/** The workspace's moderation settings, as Settings > Moderation saves them. */
async function setModerationDefault(patch: Partial<ModerationDefault>) {
  const portalConfig = JSON.stringify({
    ...DEFAULT_PORTAL_CONFIG,
    moderationDefault: { ...DEFAULT_PORTAL_CONFIG.moderationDefault, ...patch },
  })
  const existing = await testDb.query.settings.findFirst()
  if (existing) {
    await testDb.update(settings).set({ portalConfig }).where(eq(settings.id, existing.id))
  } else {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date(), portalConfig })
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms)

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
    expect(JSON.stringify(bell.config)).not.toContain('spam')
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

  function keyAudit(kind: 'personal' | 'workspace', createdById: PrincipalId, key: PrincipalId) {
    return moderationAuditFromApiAuth(
      {
        apiKey: { id: 'api_key_1', createdById, kind },
        principalId: key,
        role: 'admin',
        principal: null,
      } as unknown as Parameters<typeof moderationAuditFromApiAuth>[0],
      new Headers()
    )
  }

  it('says nothing to an author who moderates their own post through their API key', async () => {
    const author = await seedPerson('admin')
    const { postId } = await seedHeldPost(author.id)
    const keyPrincipal = await seedPerson('admin')

    await approvePost(postId, keyAudit('personal', author.id, keyPrincipal.id))

    expect(await targetsFor('post.approved')).toEqual([])
  })

  it('tells the author when a workspace key they created moderates their post: it acts for nobody', async () => {
    const author = await seedPerson('admin')
    const { postId } = await seedHeldPost(author.id)
    const keyPrincipal = await seedPerson('admin')

    await approvePost(postId, keyAudit('workspace', author.id, keyPrincipal.id))

    const targets = await targetsFor('post.approved')
    expect(bellsOf(targets)).toHaveLength(1)
    expect(bellsOf(targets)[0].target).toEqual({ principalIds: [author.id] })
  })

  it('gives a blocked author no bell and no email for the decision', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    await testDb.update(principal).set({ blockedAt: new Date() }).where(eq(principal.id, author.id))
    const held = await seedHeldPost(author.id)
    const heldComment = await seedHeldComment(author.id)

    await rejectPost(held.postId, undefined, auditFor(moderator.id))
    await approveComment(heldComment.commentId, auditFor(moderator.id))

    expect(await targetsFor('post.rejected')).toEqual([])
    expect(await targetsFor('comment.approved')).toEqual([])
  })

  it('says nothing about test feedback', async () => {
    const moderator = await seedPerson('admin')
    const author = await seedPerson('user', 'user', moderator.id)
    const { postId } = await seedHeldPost(author.id)

    await approvePost(postId, auditFor(moderator.id))

    expect(await lastEvent('post.approved')).toBeDefined()
    expect(await targetsFor('post.approved')).toEqual([])
  })

  it('says nothing for a post whose author account was deleted', async () => {
    const moderator = await seedPerson('admin')
    await testDb.transaction((tx) => ensureDeletedUserPrincipal(tx))
    const { postId } = await seedHeldPost(DELETED_USER_PRINCIPAL_ID)

    await rejectPost(postId, undefined, auditFor(moderator.id))

    expect(await targetsFor('post.rejected')).toEqual([])
  })

  it('does not name a rejected post to an author who can no longer see its board', async () => {
    const author = await seedPerson('user')
    const moderator = await seedPerson('admin')
    const { postId } = await seedHeldPost(author.id, { ...DEFAULT_BOARD_ACCESS, view: 'team' })

    await rejectPost(postId, undefined, auditFor(moderator.id))

    expect(await targetsFor('post.rejected')).toEqual([])
  })

  describe('old backlog and the workspace switch', () => {
    it('emails the author of an item submitted a day ago', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id, DEFAULT_BOARD_ACCESS, ago(DAY_MS))

      await approvePost(postId, auditFor(moderator.id))

      const targets = await targetsFor('post.approved')
      expect(emailsOf(targets)).toHaveLength(1)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('sends no email for a post submitted 30 days before the decision, and keeps the bell', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id, DEFAULT_BOARD_ACCESS, ago(30 * DAY_MS))

      await approvePost(postId, auditFor(moderator.id))

      const targets = await targetsFor('post.approved')
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('sends no email for a spam post rejected out of an old backlog, and keeps the bell', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id, DEFAULT_BOARD_ACCESS, ago(90 * DAY_MS))

      await rejectPost(postId, 'spam', auditFor(moderator.id))

      const targets = await targetsFor('post.rejected')
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('measures a comment by when the comment was submitted', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { commentId } = await seedHeldComment(author.id, ago(30 * DAY_MS))

      await approveComment(commentId, auditFor(moderator.id))

      const targets = await targetsFor('comment.approved')
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('sends no email for a decision recorded without a submission time, and keeps the bell', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id)
      await approvePost(postId, auditFor(moderator.id))
      const event = (await lastEvent('post.approved'))!
      const payload = { ...(event.payload as Record<string, unknown>) }
      expect(payload.submittedAt).toEqual(expect.any(String))
      delete payload.submittedAt

      const targets = await notificationResolver.resolve({ ...event, payload } as DomainEvent)
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    // One decision per test: events written in one transaction share a time,
    // so the outbox cannot tell two apart by order.
    it('emails about an item submitted just inside the backlog window', async () => {
      expect(MODERATION_DECISION_EMAIL_MAX_AGE_MS).toBe(14 * DAY_MS)
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(
        author.id,
        DEFAULT_BOARD_ACCESS,
        ago(MODERATION_DECISION_EMAIL_MAX_AGE_MS - 60 * 60 * 1000)
      )

      await approvePost(postId, auditFor(moderator.id))

      expect(emailsOf(await targetsFor('post.approved'))).toHaveLength(1)
    })

    it('sends no email about an item submitted just outside the backlog window', async () => {
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(
        author.id,
        DEFAULT_BOARD_ACCESS,
        ago(MODERATION_DECISION_EMAIL_MAX_AGE_MS + 60 * 60 * 1000)
      )

      await approvePost(postId, auditFor(moderator.id))

      const targets = await targetsFor('post.approved')
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('emails by default: the switch is on until a workspace turns it off', async () => {
      expect(DEFAULT_PORTAL_CONFIG.moderationDefault.emailDecisions).toBe(true)
      await setModerationDefault({})
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id)

      await approvePost(postId, auditFor(moderator.id))

      expect(emailsOf(await targetsFor('post.approved'))).toHaveLength(1)
    })

    it('emails when stored settings predate the switch', async () => {
      await setModerationDefault({ emailDecisions: undefined })
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id)

      await approvePost(postId, auditFor(moderator.id))

      expect(emailsOf(await targetsFor('post.approved'))).toHaveLength(1)
    })

    it('keeps decision emails off when another moderation setting is saved later', async () => {
      await setModerationDefault({ emailDecisions: false })
      await updatePortalConfig({ moderationDefault: { requireApproval: 'none', holdImages: true } })
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const { postId } = await seedHeldPost(author.id)

      await approvePost(postId, auditFor(moderator.id))

      const targets = await targetsFor('post.approved')
      expect(emailsOf(targets)).toHaveLength(0)
      expect(bellsOf(targets)).toHaveLength(1)
    })

    it('sends no email when the workspace turned decision emails off, and keeps the bell', async () => {
      await setModerationDefault({ emailDecisions: false })
      const author = await seedPerson('user')
      const moderator = await seedPerson('admin')
      const held = await seedHeldPost(author.id)
      const heldComment = await seedHeldComment(author.id)

      await approvePost(held.postId, auditFor(moderator.id))
      await rejectComment(heldComment.commentId, undefined, auditFor(moderator.id))

      for (const type of ['post.approved', 'comment.rejected']) {
        const targets = await targetsFor(type)
        expect(emailsOf(targets), type).toHaveLength(0)
        expect(bellsOf(targets), type).toHaveLength(1)
      }
    })
  })
})
