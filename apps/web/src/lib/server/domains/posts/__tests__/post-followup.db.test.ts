/**
 * The reviewed product follow-up (QUINN-PRODUCT P9).
 *
 * Real PostgreSQL inside the fixture's rollback. Three properties matter and
 * each has its own cases: nothing sends without a reviewer, a customer who
 * cannot or should not be written to is refused by name rather than dropped,
 * and one post plus one customer is one email however many times somebody
 * presses the button.
 *
 * The only double is the SMTP transport. Every receipt, preference, link and
 * audience row the decision reads is real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantToolCalls,
  boards,
  conversations,
  eq,
  notificationPreferences,
  postExternalLinks,
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

/** The SMTP boundary, and the only one. */
const { sendPostUpdateEmail } = vi.hoisted(() => ({
  sendPostUpdateEmail: vi.fn(
    async (_params: Record<string, unknown>): Promise<{ sent: boolean; reason?: string }> => ({
      sent: true,
    })
  ),
}))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendPostUpdateEmail,
}))

import { getFollowupAudience, sendPostFollowup, followupActionKey } from '../post.followup'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, audience: posts.audience }).from(posts).limit(0)
    await db.select({ id: assistantToolCalls.id }).from(assistantToolCalls).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

let reviewerId: PrincipalId
let boardId: BoardId

const reviewer = (): Actor => ({
  principalId: reviewerId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
})

/** Sees private posts, may not approve one, so may not decide what is said. */
const readerWithoutApprove = (): Actor => ({
  principalId: reviewerId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(['post.view_private'] as never),
})

async function seedPerson(email: string | null): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Person-${suffix()}`, ...(email ? { email } : {}) })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedPost(audience: 'board' | 'internal'): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId,
      principalId: reviewerId,
      title: 'Automatic payment reminders',
      content: 'Remind me before a charge.',
      audience,
    })
    .returning()
  return post.id
}

/** A conversation linked to the post as evidence, the way a capture links one. */
async function linkConversation(postId: PostId, principalId: PrincipalId): Promise<ConversationId> {
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority: 'none' })
    .returning()
  await testDb.insert(postExternalLinks).values({
    postId,
    integrationType: 'live_chat',
    externalId: conversation.id,
    externalUrl: `https://quackback.test/admin/inbox?i=${conversation.id}`,
  })
  return conversation.id
}

beforeEach(async () => {
  await fixture.begin()
  sendPostUpdateEmail.mockClear()
  sendPostUpdateEmail.mockResolvedValue({ sent: true })
  await testDb
    .insert(settings)
    .values({ name: 'Followup WS', slug: `fu_${suffix()}`, createdAt: new Date() })
  reviewerId = await seedPerson(`reviewer-${suffix()}@example.test`)
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `fu-${suffix()}`, name: 'Requests', access: DEFAULT_BOARD_ACCESS })
    .returning()
  boardId = board.id
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe.skipIf(!fixture.available)('the reviewed product follow-up', () => {
  describe('who may be told, and who may do the telling', () => {
    it('refuses the whole action for an internal capture, rather than filtering it', async () => {
      const postId = await seedPost('internal')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)

      const audience = await getFollowupAudience(postId, reviewer())
      expect(audience).toMatchObject({ sendable: false, reason: 'internal_audience' })
      expect(audience.recipients).toEqual([])

      await expect(
        sendPostFollowup(
          { postId, message: 'We shipped it.', conversationIds: [conversationId] },
          reviewer()
        )
      ).rejects.toThrow()
      expect(sendPostUpdateEmail).not.toHaveBeenCalled()
    })

    it('refuses a reader who cannot approve what a customer is told', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)

      await expect(
        sendPostFollowup(
          { postId, message: 'We shipped it.', conversationIds: [conversationId] },
          readerWithoutApprove()
        )
      ).rejects.toThrow()
      expect(sendPostUpdateEmail).not.toHaveBeenCalled()
    })

    it('names a customer with no address rather than dropping them from the list', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(null)
      const conversationId = await linkConversation(postId, customerId)

      const audience = await getFollowupAudience(postId, reviewer())
      expect(audience.recipients).toEqual([
        expect.objectContaining({ conversationId, email: null, blocked: 'no_address' }),
      ])

      const result = await sendPostFollowup(
        { postId, message: 'We shipped it.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(result.results).toEqual([{ conversationId, outcome: 'blocked' }])
      expect(sendPostUpdateEmail).not.toHaveBeenCalled()
    })

    it('respects a customer who muted email, and says so', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`quiet-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      await testDb
        .insert(notificationPreferences)
        .values({ principalId: customerId, emailMuted: true })

      const audience = await getFollowupAudience(postId, reviewer())
      expect(audience.recipients[0]).toMatchObject({ blocked: 'opted_out', email: null })

      const result = await sendPostFollowup(
        { postId, message: 'We shipped it.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(result.results).toEqual([{ conversationId, outcome: 'blocked' }])
      expect(sendPostUpdateEmail).not.toHaveBeenCalled()
    })

    it('refuses an empty message, because there is nothing reviewed to send', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      await expect(
        sendPostFollowup({ postId, message: '   ', conversationIds: [conversationId] }, reviewer())
      ).rejects.toThrow()
      expect(sendPostUpdateEmail).not.toHaveBeenCalled()
    })
  })

  describe('sending', () => {
    it('sends the reviewer message to the customer, with the request it is about', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)

      const result = await sendPostFollowup(
        { postId, message: 'This shipped this morning.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(result.results).toEqual([{ conversationId, outcome: 'sent' }])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(1)
      expect(sendPostUpdateEmail.mock.calls[0]?.[0]).toMatchObject({
        message: 'This shipped this morning.',
        postTitle: 'Automatic payment reminders',
      })
    })

    it('records one receipt under the post-and-customer identity', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      const receipts = await testDb
        .select()
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.actionKey, followupActionKey(postId, conversationId)))
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({ toolName: 'post_followup', outcomeStatus: 'succeeded' })
      // Stamped before the provider call, so an interruption reads as
      // attempted rather than as nothing at all.
      expect(receipts[0].dispatchedAt).not.toBeNull()
    })

    it('tells one customer once, however many times a reviewer presses send', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)

      await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      const second = await sendPostFollowup(
        { postId, message: 'This shipped, again.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(second.results).toEqual([{ conversationId, outcome: 'already_sent' }])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(1)

      // And the reviewer is told, rather than being offered the button again.
      const audience = await getFollowupAudience(postId, reviewer())
      expect(audience.recipients[0]).toMatchObject({ blocked: 'already_sent' })
      expect(audience.recipients[0].sentAt).not.toBeNull()
    })

    it('sends once when two reviewers decide at the same moment', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)

      // Both pass the pre-read, because neither has written a receipt yet.
      // The claim on the action key is what decides, not the read.
      const [first, second] = await Promise.all([
        sendPostFollowup(
          { postId, message: 'This shipped.', conversationIds: [conversationId] },
          reviewer()
        ),
        sendPostFollowup(
          { postId, message: 'This shipped.', conversationIds: [conversationId] },
          reviewer()
        ),
      ])
      const outcomes = [first.results[0].outcome, second.results[0].outcome].sort()
      expect(outcomes).toEqual(['already_sent', 'sent'])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(1)
    })

    it('lets a reviewer try again after a refused send, which is not a send', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      sendPostUpdateEmail.mockResolvedValueOnce({ sent: false, reason: 'provider down' })

      const first = await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(first.results).toEqual([{ conversationId, outcome: 'failed' }])
      // The reviewer is offered the row again, and the retry actually sends,
      // under the same receipt rather than a second one.
      const audience = await getFollowupAudience(postId, reviewer())
      expect(audience.recipients[0]).toMatchObject({ blocked: null })

      const second = await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(second.results).toEqual([{ conversationId, outcome: 'sent' }])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(2)
      const receipts = await testDb
        .select()
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.actionKey, followupActionKey(postId, conversationId)))
      expect(receipts).toHaveLength(1)
      expect(receipts[0].outcomeStatus).toBe('succeeded')
    })

    it('allows only one reviewer to reclaim a failed receipt', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`retry-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      const input = { postId, message: 'This shipped.', conversationIds: [conversationId] }
      sendPostUpdateEmail.mockResolvedValueOnce({ sent: false, reason: 'refused' })
      expect((await sendPostFollowup(input, reviewer())).results[0].outcome).toBe('failed')
      const results = await Promise.all([
        sendPostFollowup(input, reviewer()),
        sendPostFollowup(input, reviewer()),
      ])
      expect(results.map((result) => result.results[0].outcome).sort()).toEqual([
        'already_sent',
        'sent',
      ])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(2)
    })

    it('leaves an unconfirmed send for a person instead of resending it', async () => {
      const postId = await seedPost('board')
      const customerId = await seedPerson(`maya-${suffix()}@example.test`)
      const conversationId = await linkConversation(postId, customerId)
      sendPostUpdateEmail.mockRejectedValueOnce(new Error('connection reset'))

      const result = await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(result.results).toEqual([{ conversationId, outcome: 'unconfirmed' }])
      const [receipt] = await testDb
        .select()
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.actionKey, followupActionKey(postId, conversationId)))
      expect(receipt).toMatchObject({ outcomeStatus: 'unknown', reconciliationState: 'required' })
      expect(receipt.settledAt).toBeNull()

      // A second press does not gamble on it.
      const second = await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [conversationId] },
        reviewer()
      )
      expect(second.results).toEqual([{ conversationId, outcome: 'already_sent' }])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(1)
    })

    it('sends to each chosen customer separately, and only to those chosen', async () => {
      const postId = await seedPost('board')
      const first = await seedPerson(`a-${suffix()}@example.test`)
      const second = await seedPerson(`b-${suffix()}@example.test`)
      const firstConversation = await linkConversation(postId, first)
      await linkConversation(postId, second)

      const result = await sendPostFollowup(
        { postId, message: 'This shipped.', conversationIds: [firstConversation] },
        reviewer()
      )
      expect(result.results).toEqual([{ conversationId: firstConversation, outcome: 'sent' }])
      expect(sendPostUpdateEmail).toHaveBeenCalledTimes(1)
    })
  })
})
