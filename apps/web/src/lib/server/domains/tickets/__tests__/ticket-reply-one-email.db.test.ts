/**
 * One email per teammate reply on a customer ticket (CUS-O-17).
 *
 * A customer ticket is paired with a conversation, and a teammate's reply lands
 * on that conversation whichever view it was typed in. Two emails used to
 * follow it: the conversation email (notifyAgentReply) and the ticket reply
 * email (getTicketRepliedEmailTargets). The customer now gets one, the
 * conversation email, and it honours the same two settings the ticket email
 * did: the "Ticket replies" email switch and "Stop watching" on the ticket.
 * "Pause all email" does not stop it: a teammate's reply is not a
 * notification.
 *
 * Real database (rolled back per test). Only the edges are doubles: presence,
 * the channel adapter that would hand the mail to the transport, the hook
 * context and the support switches.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

// Presence: who is "online" is decided per test.
const presence = vi.hoisted(() => ({ online: new Set<string>() }))
vi.mock('@/lib/server/realtime/presence', () => ({
  isPrincipalOnline: async (id: string) => presence.online.has(id),
  readAvailableAgentIds: async () => [],
}))

// The channel adapter is where the conversation email leaves for the
// transport. The double records every delivery with its recipient, so a
// delivery to the wrong address is as visible as a missing one.
const deliveries = vi.hoisted(() => [] as Array<{ recipient: string; channel: string }>)
vi.mock('@/lib/server/domains/channels', () => ({
  requireChannelAdapter: (channel: string) => ({
    deliverAgentMessage: async (ctx: { recipient: string }) => {
      deliveries.push({ recipient: ctx.recipient, channel })
    },
  }),
}))

vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  }),
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => true,
  isSupportTicketsEnabled: async () => true,
}))

// Filing a ticket through intake publishes and emits; none of that is under
// test here, only the rows it leaves behind.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationAssigned: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  notificationPreferences,
  principal,
  settings,
  ticketConversations,
  ticketStatuses,
  ticketSubscriptions,
  tickets,
  user,
  eq,
} from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import type { HookContext } from '@/lib/server/events/hook-context'
import { notifyAgentReply } from '@/lib/server/domains/conversation/conversation.notify'
import { getTicketRepliedEmailTargets } from '@/lib/server/events/targets'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: ticketSubscriptions.id }).from(ticketSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(
  role: 'admin' | 'user',
  email: string
): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return { id, email }
}

async function seedStatus(): Promise<TicketStatusId> {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const id = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({
    id,
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
    isDefault: true,
  })
  return id
}

interface Scene {
  agent: { id: PrincipalId; email: string }
  customer: { id: PrincipalId; email: string }
  ticketId: TicketId
  conversationId: ConversationId
}

/**
 * A customer ticket the customer watches (as intake leaves it) and a teammate
 * watches, paired with the customer's conversation unless `paired: false`.
 */
async function seedScene(opts: { paired?: boolean } = {}): Promise<Scene> {
  const statusId = await seedStatus()
  const agent = await seedPerson('admin', `agent-${suffix()}@acme.test`)
  const customer = await seedPerson('user', `customer-${suffix()}@example.com`)
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({
    id: ticketId,
    title: 'Cannot export',
    statusId,
    type: 'customer',
    requesterPrincipalId: customer.id,
  })
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: customer.id, channel: 'messenger' })
  if (opts.paired !== false) {
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })
  }
  await testDb.insert(ticketSubscriptions).values([
    { ticketId, principalId: customer.id, reason: 'requester' },
    { ticketId, principalId: agent.id, reason: 'replier' },
  ])
  return { agent, customer, ticketId, conversationId }
}

async function turnOffTicketReplyEmail(principalId: PrincipalId): Promise<void> {
  await testDb
    .insert(notificationPreferences)
    .values({ principalId, matrix: { ticket_replied: { email: false } } })
}

async function pauseAllEmail(principalId: PrincipalId): Promise<void> {
  await testDb.insert(notificationPreferences).values({ principalId, emailMuted: true })
}

async function stopWatching(ticketId: TicketId, principalId: PrincipalId): Promise<void> {
  const { unsubscribeFromTicket } = await import('../ticket-subscription.service')
  await unsubscribeFromTicket(principalId, ticketId)
}

/** The conversation email for a teammate reply, awaited end to end. */
async function conversationEmailsFor(scene: Scene): Promise<string[]> {
  await notifyAgentReply({
    conversationId: scene.conversationId,
    visitorPrincipalId: scene.customer.id,
    content: 'Here is the fix.',
    agentName: 'Sam',
    channel: 'messenger',
  })
  return deliveries.map((d) => d.recipient)
}

const context = {
  workspaceName: 'Acme',
  portalBaseUrl: 'https://acme.test',
  logoUrl: null,
} as HookContext

function agentReplied(scene: Scene): EventData {
  return {
    id: `evt_${suffix()}`,
    type: 'ticket.replied',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: scene.agent.id },
    data: {
      ticket: { id: scene.ticketId, number: 7, type: 'customer', assignedTeamId: null },
      messageId: 'message_1',
      content: 'Here is the fix.',
      attachments: [],
      senderType: 'agent',
      title: 'Cannot export',
      authorName: 'Sam',
      requesterPrincipalId: scene.customer.id,
    },
  } as unknown as EventData
}

/** Ticket reply emails, by address. The teammate replying is the actor, so a
 *  second watching teammate stands in for "the team still hears". */
async function ticketReplyEmailsFor(scene: Scene): Promise<string[]> {
  const targets = await getTicketRepliedEmailTargets(agentReplied(scene), context)
  return targets.map((t) => (t.target as { email: string }).email)
}

async function addWatchingTeammate(scene: Scene): Promise<string> {
  const teammate = await seedPerson('admin', `teammate-${suffix()}@acme.test`)
  await testDb
    .insert(ticketSubscriptions)
    .values({ ticketId: scene.ticketId, principalId: teammate.id, reason: 'manual' })
  return teammate.email
}

describe.skipIf(!fixture.available)('one email per teammate reply on a customer ticket', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    deliveries.length = 0
    presence.online.clear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the ticket reply email', () => {
    it('leaves the customer out when the ticket has a conversation, and still tells the team', async () => {
      const scene = await seedScene()
      const teammate = await addWatchingTeammate(scene)
      expect(await ticketReplyEmailsFor(scene)).toEqual([teammate])
    })

    it('still emails the customer on a ticket with no conversation', async () => {
      const scene = await seedScene({ paired: false })
      expect(await ticketReplyEmailsFor(scene)).toEqual([scene.customer.email])
    })

    it('on a ticket with no conversation, honours Ticket replies off', async () => {
      const scene = await seedScene({ paired: false })
      await turnOffTicketReplyEmail(scene.customer.id)
      expect(await ticketReplyEmailsFor(scene)).toEqual([])
    })

    it('on a ticket with no conversation, still sends the reply when all email is paused', async () => {
      const scene = await seedScene({ paired: false })
      await pauseAllEmail(scene.customer.id)
      expect(await ticketReplyEmailsFor(scene)).toEqual([scene.customer.email])
    })

    it('keeps "Pause all email" for a watching teammate', async () => {
      const scene = await seedScene()
      const teammateEmail = await addWatchingTeammate(scene)
      const [teammate] = await testDb
        .select({ id: principal.id })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(eq(user.email, teammateEmail))
      await pauseAllEmail(teammate!.id as PrincipalId)
      expect(await ticketReplyEmailsFor(scene)).toEqual([])
    })
  })

  describe('the conversation email on a ticket', () => {
    it('sends one email by default', async () => {
      const scene = await seedScene()
      expect(await conversationEmailsFor(scene)).toEqual([scene.customer.email])
    })

    it('sends nothing when the customer turned Ticket replies off', async () => {
      const scene = await seedScene()
      await turnOffTicketReplyEmail(scene.customer.id)
      expect(await conversationEmailsFor(scene)).toEqual([])
    })

    it('sends nothing when the customer stopped watching the ticket', async () => {
      const scene = await seedScene()
      await stopWatching(scene.ticketId, scene.customer.id)
      expect(await conversationEmailsFor(scene)).toEqual([])
    })

    it('sends nothing while the customer is online in the messenger', async () => {
      const scene = await seedScene()
      presence.online.add(scene.customer.id)
      expect(await conversationEmailsFor(scene)).toEqual([])
    })

    it('still sends when the customer paused all email', async () => {
      const scene = await seedScene()
      await pauseAllEmail(scene.customer.id)
      expect(await conversationEmailsFor(scene)).toEqual([scene.customer.email])
    })

    it('sends one email on a ticket filed through intake, which makes the customer a watcher', async () => {
      await seedStatus()
      const customer = await seedPerson('user', `customer-${suffix()}@example.com`)
      const { createTicketCore } = await import('../ticket.service')
      const ticket = await createTicketCore(
        {
          type: 'customer',
          title: 'Cannot export',
          requesterPrincipalId: customer.id,
          withBackingConversation: true,
        },
        { ...ANONYMOUS_ACTOR, principalId: customer.id, principalType: 'user' }
      )
      const [link] = await testDb
        .select({ conversationId: ticketConversations.conversationId })
        .from(ticketConversations)
        .where(eq(ticketConversations.ticketId, ticket.id as TicketId))
      expect(link).toBeTruthy()

      await notifyAgentReply({
        conversationId: link!.conversationId as ConversationId,
        visitorPrincipalId: customer.id,
        content: 'Here is the fix.',
        agentName: 'Sam',
        channel: 'messenger',
      })
      expect(deliveries.map((d) => d.recipient)).toEqual([customer.email])
    })

    it('ignores the ticket settings on a conversation with no ticket', async () => {
      const scene = await seedScene({ paired: false })
      await turnOffTicketReplyEmail(scene.customer.id)
      await stopWatching(scene.ticketId, scene.customer.id)
      expect(await conversationEmailsFor(scene)).toEqual([scene.customer.email])
    })
  })
})
