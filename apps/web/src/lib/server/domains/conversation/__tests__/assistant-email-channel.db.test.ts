/**
 * Autonomous Quinn replies on the email channel (QUINN-PRODUCT P9).
 *
 * Real PostgreSQL inside the fixture's rollback. This is the channel's own
 * acceptance suite, which the specification requires before the channel may be
 * enabled at all: the eligibility rules, the delivery record that exists from
 * the moment the answer commits, and the threading headers the reply actually
 * carries.
 *
 * Nothing here doubles a conversation, a message, a delivery record or the
 * threading assembly: those are the mechanism. What is doubled is the SMTP
 * transport, because a test cannot observe a real mailbox, and the settings
 * read behind the channel switch.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'

// The email channel's two halves, set before any config read: without a mint
// domain there is no Message-ID to thread from, which is a different test.
process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)
process.env.EMAIL_INBOUND_DOMAIN = 'inbound.quackback.test'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  conversationMessages,
  conversationOutboundEmails,
  conversations,
  principal,
  settings,
  ticketConversations,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { channelEnabled } = vi.hoisted(() => ({ channelEnabled: { value: true } }))
vi.mock('@/lib/server/domains/settings/settings.assistant-channels', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/settings/settings.assistant-channels')
  >()),
  getAssistantChannels: vi.fn(async () => ({ email: { enabled: channelEnabled.value } })),
}))

/** The SMTP boundary. Everything up to it, including threading, is real. */
type SendResult = { sent: boolean; messageId?: string | null; reason?: string }
const { sendConversationMessageEmail } = vi.hoisted(() => ({
  sendConversationMessageEmail: vi.fn(
    async (
      _params: Record<string, unknown>
    ): Promise<{ sent: boolean; messageId?: string | null; reason?: string }> => ({ sent: true })
  ),
}))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendConversationMessageEmail,
}))

import {
  assistantChannelEligibility,
  type ChannelIneligibility,
} from '../assistant-channel-eligibility'
import { assistantTurnSurfaceFor } from '../conversation.service'
import { deliverAssistantEmail } from '../assistant-email-delivery'
import { persistChannelDelivery } from '../conversation.channel-delivery'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db
      .select({ messageId: conversationOutboundEmails.messageId })
      .from(conversationOutboundEmails)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** The workspace row the outbound mail context reads its name and logo from. */
async function seedSettings(): Promise<void> {
  const existing = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (existing.length > 0) return
  await testDb
    .insert(settings)
    .values({ name: 'Test workspace', slug: `ws-${suffix()}`, createdAt: new Date() })
}

interface SeedOptions {
  source?: string
  unverifiedSender?: boolean
  visitorEmail?: string | null
  status?: 'open' | 'closed'
  endReason?: string | null
  assigned?: boolean
  inboundMessageId?: string | null
}

async function seedEmailConversation(options: SeedOptions = {}) {
  await seedSettings()
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Person-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: principalId,
      channel: 'email',
      source: options.source ?? 'email',
      priority: 'none',
      status: options.status ?? 'open',
      endReason: options.endReason ?? null,
      visitorEmail:
        options.visitorEmail === undefined
          ? `customer-${suffix()}@example.com`
          : options.visitorEmail,
      customAttributes: options.unverifiedSender ? { unverifiedSender: true } : {},
      ...(options.assigned ? { assignedAgentPrincipalId: principalId } : {}),
    })
    .returning()
  const inboundMessageId =
    options.inboundMessageId === undefined
      ? `inbound.${suffix()}@customer.example`
      : options.inboundMessageId
  if (inboundMessageId) {
    await testDb.insert(conversationMessages).values({
      conversationId: conversation.id,
      principalId,
      senderType: 'visitor',
      content: 'My invoice is wrong.',
      metadata: { source: 'email', emailMessageId: inboundMessageId },
    })
  }
  return { conversation, principalId, inboundMessageId }
}

/** Commit an assistant answer the way the publication path does, by hand. */
async function seedAssistantAnswer(
  conversationId: ConversationId,
  principalId: PrincipalId
): Promise<ConversationMessageId> {
  const [message] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId,
      senderType: 'agent',
      content: 'Your invoice was reissued this morning.',
      metadata: {
        assistantResponseKind: 'answer',
        channelDelivery: { channel: 'email', status: 'pending', at: new Date().toISOString() },
      },
    })
    .returning()
  return message.id
}

async function deliveryRecordOf(messageId: ConversationMessageId) {
  const [row] = await testDb
    .select({ metadata: conversationMessages.metadata })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  return row?.metadata?.channelDelivery ?? null
}

beforeEach(() => {
  channelEnabled.value = true
  sendConversationMessageEmail.mockClear()
  sendConversationMessageEmail.mockResolvedValue({ sent: true } satisfies SendResult)
})

describe.skipIf(!fixture.available)('autonomous Quinn replies on email', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('eligibility', () => {
    it('allows a verified sender on an open thread when the channel is on', async () => {
      const { conversation } = await seedEmailConversation()
      expect(await assistantChannelEligibility(conversation, testDb)).toEqual({ eligible: true })
    })

    const refusals: Array<[string, SeedOptions, ChannelIneligibility]> = [
      ['an unverified sender', { unverifiedSender: true }, 'unverified_sender'],
      ['no address on file', { visitorEmail: null }, 'no_address'],
      ['a closed thread', { status: 'closed' }, 'not_open'],
      ['a thread filed as spam', { endReason: 'spam' }, 'not_open'],
      ['a teammate who took it over', { assigned: true }, 'taken_over'],
      ['nothing to thread the reply from', { inboundMessageId: null }, 'no_thread'],
      ['a source that is not the email channel', { source: 'ticket_form' }, 'unsupported_source'],
    ]

    it.each(refusals)('refuses %s', async (_name, options, reason) => {
      const { conversation } = await seedEmailConversation(options)
      expect(await assistantChannelEligibility(conversation, testDb)).toEqual({
        eligible: false,
        reason,
      })
    })

    it('refuses everything while the channel is off, which is the default', async () => {
      channelEnabled.value = false
      const { conversation } = await seedEmailConversation()
      expect(await assistantChannelEligibility(conversation, testDb)).toEqual({
        eligible: false,
        reason: 'channel_disabled',
      })
    })
  })

  describe('the intake gate', () => {
    it('labels an eligible email conversation with the email surface', async () => {
      const { conversation } = await seedEmailConversation()
      expect(await assistantTurnSurfaceFor(conversation, 'open', testDb)).toBe('email')
    })

    it('gives an ineligible one no surface at all, rather than the widget one', async () => {
      channelEnabled.value = false
      const { conversation } = await seedEmailConversation()
      expect(await assistantTurnSurfaceFor(conversation, 'open', testDb)).toBeNull()
    })

    it('leaves the widget channel exactly as it was', async () => {
      const { conversation } = await seedEmailConversation({ source: 'widget' })
      expect(await assistantTurnSurfaceFor(conversation, 'open', testDb)).toBe('widget')
      // A thread a human deliberately closed still never summons Quinn.
      expect(await assistantTurnSurfaceFor(conversation, 'closed', testDb)).toBeNull()
    })
  })

  describe('delivery', () => {
    it('threads the reply from the inbound Message-ID and records it as sent', async () => {
      const { conversation, principalId, inboundMessageId } = await seedEmailConversation()
      const messageId = await seedAssistantAnswer(conversation.id, principalId)

      await deliverAssistantEmail({
        jobId: 'job_1',
        payload: { messageId, conversationId: conversation.id, agentName: 'Quinn' },
      } as never)

      expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
      const sent = sendConversationMessageEmail.mock.calls[0]?.[0] ?? {}
      expect(sent.to).toBe(conversation.visitorEmail)
      expect(sent.senderName).toBe('Quinn')
      // The customer's own message is what this reply answers, and the
      // References chain carries it, so the reply lands in their thread.
      expect(sent.inReplyTo).toBe(inboundMessageId)
      expect(sent.references).toContain(inboundMessageId)
      // A Message-ID keyed by this message, so a retry threads identically.
      expect(String(sent.messageId)).toContain(messageId.replace(/^[a-z_]+_/, '').slice(0, 8))

      expect(await deliveryRecordOf(messageId)).toMatchObject({
        channel: 'email',
        status: 'sent',
      })
      // And the id we sent under is recorded, so the customer's reply resolves
      // back to this conversation.
      const recorded = await testDb
        .select()
        .from(conversationOutboundEmails)
        .where(eq(conversationOutboundEmails.conversationId, conversation.id))
      expect(recorded).toHaveLength(1)
    })

    it('sends nothing and says why when the thread was taken over after the answer committed', async () => {
      const { conversation, principalId } = await seedEmailConversation()
      const messageId = await seedAssistantAnswer(conversation.id, principalId)
      await testDb
        .update(conversations)
        .set({ assignedAgentPrincipalId: principalId })
        .where(eq(conversations.id, conversation.id))

      await deliverAssistantEmail({
        jobId: 'job_2',
        payload: { messageId, conversationId: conversation.id },
      } as never)

      expect(sendConversationMessageEmail).not.toHaveBeenCalled()
      expect(await deliveryRecordOf(messageId)).toMatchObject({
        status: 'failed',
        error: 'Not sent: taken over.',
      })
    })

    it('sends nothing when the channel was turned off after the answer committed', async () => {
      const { conversation, principalId } = await seedEmailConversation()
      const messageId = await seedAssistantAnswer(conversation.id, principalId)
      channelEnabled.value = false

      await deliverAssistantEmail({
        jobId: 'job_3',
        payload: { messageId, conversationId: conversation.id },
      } as never)

      expect(sendConversationMessageEmail).not.toHaveBeenCalled()
      expect(await deliveryRecordOf(messageId)).toMatchObject({ status: 'failed' })
    })

    it('never sends a second copy once the record says sent', async () => {
      const { conversation, principalId } = await seedEmailConversation()
      const messageId = await seedAssistantAnswer(conversation.id, principalId)
      await persistChannelDelivery(messageId, { status: 'sent', channel: 'email' })

      await deliverAssistantEmail({
        jobId: 'job_4',
        payload: { messageId, conversationId: conversation.id },
      } as never)

      expect(sendConversationMessageEmail).not.toHaveBeenCalled()
    })

    it('records a failure and rethrows so the queue retries an answer nobody received', async () => {
      const { conversation, principalId } = await seedEmailConversation()
      const messageId = await seedAssistantAnswer(conversation.id, principalId)
      sendConversationMessageEmail.mockResolvedValue({
        sent: false,
        reason: 'provider down',
      } satisfies SendResult)

      await expect(
        deliverAssistantEmail({
          jobId: 'job_5',
          payload: { messageId, conversationId: conversation.id },
        } as never)
      ).rejects.toThrow()
      expect(await deliveryRecordOf(messageId)).toMatchObject({ status: 'failed' })
    })
  })

  describe('what the channel does not change', () => {
    it('leaves a paired customer ticket out, because the thread is the ticket', async () => {
      const { conversation } = await seedEmailConversation()
      // The pair probe is the dispatch site's, and it runs for an email turn
      // exactly as it does for a widget one: this asserts the shape the probe
      // reads exists and is empty for an ordinary email thread.
      const paired = await testDb
        .select({ ticketId: ticketConversations.ticketId })
        .from(ticketConversations)
        .where(
          and(
            eq(ticketConversations.conversationId, conversation.id),
            eq(ticketConversations.ticketType, 'customer')
          )
        )
      expect(paired).toHaveLength(0)
      expect(await assistantChannelEligibility(conversation, testDb)).toEqual({ eligible: true })
    })

    it('closes natively: a closed thread is nobody to answer, whatever the channel says', async () => {
      const { conversation } = await seedEmailConversation()
      await testDb
        .update(conversations)
        .set({ status: 'closed', resolvedAt: new Date() })
        .where(eq(conversations.id, conversation.id))
      const [closed] = await testDb
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversation.id)))
      expect(await assistantChannelEligibility(closed, testDb)).toEqual({
        eligible: false,
        reason: 'not_open',
      })
    })
  })
})
