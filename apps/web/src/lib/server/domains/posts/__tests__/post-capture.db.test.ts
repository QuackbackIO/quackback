/**
 * Internal feedback capture: attribution, silence, identity and publication.
 *
 * Every case runs the real command against a real database, and the silence
 * cases carry a positive control: the same assertion is made against an
 * ordinary board post created through the same `createPost`, so a case that
 * passed because nothing was wired up at all would fail on the control.
 *
 * The event assertion spies on `processEvent`, which is the single funnel
 * `dispatchEvent` hands every event to. It records the event types rather
 * than swallowing them, and the control proves it can see one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  boards,
  eq,
  postActivity,
  postComments,
  postExternalLinks,
  postStatuses,
  postSubscriptions,
  postVotes,
  posts,
  principal,
  settings,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** The real dispatch funnel, recorded rather than swallowed. */
const processed: string[] = []
vi.mock('@/lib/server/events/process', () => ({
  processEvent: vi.fn(async (event: { type: string }) => {
    processed.push(event.type)
  }),
}))

import { captureInternalFeedback, publishCaptureToBoard } from '../post.capture'
import { createPost } from '../post.service'
import { changeStatus } from '../post.status'
import { getPublicPostDetail } from '../post.public.detail'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, captureKey: posts.captureKey }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

let customerPrincipalId: PrincipalId
let assistantPrincipalId: PrincipalId
let boardId: BoardId
let conversationId: ConversationId

const teamActor = (): Actor => ({
  principalId: assistantPrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
})

const customerActor = (): Actor => ({
  principalId: customerPrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
})

/** A teammate who may see private posts but may not approve one. */
const reviewerWithoutApprove = (): Actor => ({
  principalId: assistantPrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(['none' as never]),
  permissions: new Set(['post.view_private'] as never),
})

async function seedPrincipal(role: 'admin' | 'user', name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `${suffix()}@example.test` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

function captureCtx() {
  return {
    actor: teamActor(),
    capturedByPrincipalId: assistantPrincipalId,
    customerPrincipalId,
  }
}

async function capture(overrides?: { captureKey?: string; title?: string; content?: string }) {
  return captureInternalFeedback(
    {
      conversationId,
      boardId,
      title: overrides?.title ?? 'Automatic payment reminders',
      content: overrides?.content ?? 'The customer asked for reminders before a charge.',
      captureKey: overrides?.captureKey ?? `conv:${conversationId}:capture_feedback:abc`,
      kind: 'assistant',
    },
    captureCtx()
  )
}

describe.skipIf(!fixture.available)('internal feedback capture (real DB)', () => {
  let statusId: PostStatusId

  beforeEach(async () => {
    await fixture.begin()
    processed.length = 0
    // createPost resolves the workspace moderation default, which needs the
    // settings row a fresh schema does not carry.
    await testDb
      .insert(settings)
      .values({ name: 'Capture WS', slug: `cap_${suffix()}`, createdAt: new Date() })
    customerPrincipalId = await seedPrincipal('user', 'Maya')
    assistantPrincipalId = await seedPrincipal('admin', 'Quinn')
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `cap-${suffix()}`, name: 'Capture board', access: DEFAULT_BOARD_ACCESS })
      .returning()
    boardId = board.id
    const [status] = await testDb
      .insert(postStatuses)
      .values({ slug: `open-${suffix()}`, name: 'Open', color: '#000000', position: 1 })
      .returning()
    statusId = status.id
    conversationId = createId('conversation') as ConversationId
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('attribution and provenance', () => {
    it('creates one internal post for the real customer, captured by Quinn', async () => {
      const result = await capture()
      expect(result.outcome).toBe('captured')

      const [row] = await testDb.select().from(posts).where(eq(posts.id, result.postId))
      expect(row.audience).toBe('internal')
      expect(row.principalId).toBe(customerPrincipalId)
      expect(row.trackedByPrincipalId).toBe(assistantPrincipalId)
      expect(row.moderationState).toBe('published')
      expect(row.captureProvenance).toMatchObject({ kind: 'assistant', conversationId })
    })

    it('records the conversation backlink', async () => {
      const result = await capture()
      const links = await testDb
        .select()
        .from(postExternalLinks)
        .where(eq(postExternalLinks.postId, result.postId))
      expect(links).toHaveLength(1)
      expect(links[0].integrationType).toBe('live_chat')
      expect(links[0].externalId).toBe(conversationId)
    })
  })

  describe('silence', () => {
    /** The positive control: an ordinary board post through the same service. */
    async function boardControl(): Promise<PostId> {
      const post = await createPost(
        { boardId, statusId, title: 'An ordinary request', content: 'body' },
        { principalId: customerPrincipalId, actor: teamActor() }
      )
      return post.id
    }

    it('casts no vote, where an ordinary post casts one', async () => {
      const captured = await capture()
      const control = await boardControl()

      const capturedVotes = await testDb
        .select()
        .from(postVotes)
        .where(eq(postVotes.postId, captured.postId))
      const controlVotes = await testDb
        .select()
        .from(postVotes)
        .where(eq(postVotes.postId, control))
      expect(capturedVotes).toHaveLength(0)
      expect(controlVotes).toHaveLength(1)

      const [row] = await testDb.select().from(posts).where(eq(posts.id, captured.postId))
      expect(row.voteCount).toBe(0)
    })

    it('creates no subscription, where an ordinary post subscribes its author', async () => {
      const captured = await capture()
      const control = await boardControl()

      const capturedSubs = await testDb
        .select()
        .from(postSubscriptions)
        .where(eq(postSubscriptions.postId, captured.postId))
      const controlSubs = await testDb
        .select()
        .from(postSubscriptions)
        .where(eq(postSubscriptions.postId, control))
      expect(capturedSubs).toHaveLength(0)
      expect(controlSubs.length).toBeGreaterThan(0)
    })

    it('writes no activity row, where an ordinary post writes post.created', async () => {
      const captured = await capture()
      const control = await boardControl()

      const capturedActivity = await testDb
        .select()
        .from(postActivity)
        .where(eq(postActivity.postId, captured.postId))
      const controlActivity = await testDb
        .select()
        .from(postActivity)
        .where(eq(postActivity.postId, control))
      expect(capturedActivity).toHaveLength(0)
      expect(controlActivity.length).toBeGreaterThan(0)
    })

    it('dispatches no event, where an ordinary post dispatches post.created', async () => {
      await capture()
      expect(processed).toEqual([])

      await boardControl()
      expect(processed).toContain('post.created')
    })

    it('dispatches nothing for a LATER change to a capture either', async () => {
      // The silence above comes from createPost. This one comes from the
      // dispatch funnel: a teammate triaging a capture in the feedback console
      // runs the ordinary status service, which dispatches post.status_changed
      // for any other post. Nothing downstream of that event has an audience
      // concept, so the event itself must not be raised.
      const captured = await capture()
      const control = await boardControl()
      const [other] = await testDb
        .insert(postStatuses)
        .values({ slug: `planned-${suffix()}`, name: 'Planned', color: '#111111', position: 2 })
        .returning()

      processed.length = 0
      await changeStatus(captured.postId, other.id, { principalId: assistantPrincipalId })
      expect(processed).toEqual([])

      await changeStatus(control, other.id, { principalId: assistantPrincipalId })
      expect(processed).toContain('post.status_changed')
    })
  })

  describe('identity', () => {
    it('a repeat under the same key returns the first post and writes no second one', async () => {
      const first = await capture()
      const second = await capture()

      expect(second.outcome).toBe('already_captured')
      expect(second.postId).toBe(first.postId)

      const rows = await testDb.select().from(posts).where(eq(posts.boardId, boardId))
      expect(rows).toHaveLength(1)
    })

    it('a repeat with reworded arguments under the same key still resolves to the first post', async () => {
      const first = await capture()
      const second = await capture({ title: 'Reminders before a charge', content: 'reworded' })
      expect(second.postId).toBe(first.postId)

      // The stored post is the one that was actually written. A replay answers
      // with it; it does not rewrite it.
      const [row] = await testDb.select().from(posts).where(eq(posts.id, first.postId))
      expect(row.title).toBe('Automatic payment reminders')
    })

    it('a different key is a different capture', async () => {
      const first = await capture({ captureKey: 'key-one' })
      const second = await capture({ captureKey: 'key-two', title: 'Something else' })
      expect(second.postId).not.toBe(first.postId)
      expect(second.outcome).toBe('captured')
    })

    it('the database itself refuses a second post under one capture key', async () => {
      const first = await capture({ captureKey: 'shared-key' })
      await expect(
        testDb.insert(posts).values({
          boardId,
          title: 'A racing duplicate',
          content: '',
          principalId: customerPrincipalId,
          audience: 'internal',
          captureKey: 'shared-key',
        })
      ).rejects.toThrow()
      expect(first.postId).toBeTruthy()
    })
  })

  describe('publication', () => {
    it('refuses a teammate without the approve permission', async () => {
      const captured = await capture()
      await expect(
        publishCaptureToBoard(
          { postId: captured.postId, title: 'Reviewed title', content: 'Reviewed body' },
          reviewerWithoutApprove()
        )
      ).rejects.toThrow(/cannot publish/i)

      const [row] = await testDb.select().from(posts).where(eq(posts.id, captured.postId))
      expect(row.audience).toBe('internal')
    })

    it('exposes only the reviewed fields, never the captured evidence', async () => {
      const captured = await capture({
        content: 'Customer said: "my card was charged twice, see ticket 88"',
      })
      // Private evidence, the way a teammate attaches it.
      await testDb.insert(postComments).values({
        postId: captured.postId,
        principalId: assistantPrincipalId,
        content: 'Tracked from a support conversation:\n\nmy card was charged twice',
        isTeamMember: true,
        isPrivate: true,
      })

      await publishCaptureToBoard(
        {
          postId: captured.postId,
          title: 'Automatic payment reminders',
          content: 'Send a reminder before a recurring charge.',
        },
        teamActor()
      )

      const [row] = await testDb.select().from(posts).where(eq(posts.id, captured.postId))
      expect(row.audience).toBe('board')
      expect(row.title).toBe('Automatic payment reminders')
      expect(row.content).toBe('Send a reminder before a recurring charge.')
      expect(row.content).not.toContain('charged twice')

      // The evidence is still evidence: the private comment stays private and
      // the conversation backlink is untouched.
      const comments = await testDb
        .select()
        .from(postComments)
        .where(and(eq(postComments.postId, captured.postId), eq(postComments.isPrivate, true)))
      expect(comments).toHaveLength(1)
    })

    it('adds no vote and no subscription when it publishes', async () => {
      const captured = await capture()
      await publishCaptureToBoard(
        { postId: captured.postId, title: 'Reviewed', content: 'Reviewed body' },
        teamActor()
      )

      const votes = await testDb
        .select()
        .from(postVotes)
        .where(eq(postVotes.postId, captured.postId))
      const subs = await testDb
        .select()
        .from(postSubscriptions)
        .where(eq(postSubscriptions.postId, captured.postId))
      expect(votes).toHaveLength(0)
      expect(subs).toHaveLength(0)

      const [row] = await testDb.select().from(posts).where(eq(posts.id, captured.postId))
      expect(row.voteCount).toBe(0)
    })

    it('is what makes the post readable by the customer, and announces it then', async () => {
      const captured = await capture()
      expect(await getPublicPostDetail(captured.postId, customerActor())).toBeNull()

      processed.length = 0
      await publishCaptureToBoard(
        { postId: captured.postId, title: 'Reviewed', content: 'Reviewed body' },
        teamActor()
      )

      const detail = await getPublicPostDetail(captured.postId, customerActor())
      expect(detail?.id).toBe(captured.postId)
      expect(processed).toContain('post.created')
    })

    it('refuses a second publication of the same post', async () => {
      const captured = await capture()
      await publishCaptureToBoard(
        { postId: captured.postId, title: 'Reviewed', content: 'body' },
        teamActor()
      )
      await expect(
        publishCaptureToBoard(
          { postId: captured.postId, title: 'Reviewed again', content: 'body' },
          teamActor()
        )
      ).rejects.toThrow(/already on its board/i)
    })
  })
})
