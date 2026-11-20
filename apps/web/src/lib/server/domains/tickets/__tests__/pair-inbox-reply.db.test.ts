/**
 * A teammate's reply typed in the inbox on a customer ticket's conversation is
 * a reply on that ticket, the same as one typed in the ticket view: the
 * replier starts watching the ticket and the ticket counts as updated. Before,
 * only the ticket view did either, so an inbox reply left the replier out of
 * the ticket's alerts and left the ticket's place in "recently updated" lists
 * where it was. The ticket.replied signal still goes out exactly once.
 *
 * Real conversation send and real Postgres (rolled back); only realtime,
 * webhooks and the reply email are doubles.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  principal,
  ticketConversations,
  ticketStatuses,
  ticketSubscriptions,
  tickets,
  user,
  and,
  eq,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

const spies = vi.hoisted(() => ({ emitTicketReplied: vi.fn(async () => {}) }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
  publishTicketEvent: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.notify', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/conversation/conversation.notify')>()),
  notifyAgentReply: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/domains/conversation/routing', () => ({
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: null })),
}))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  hasLiveWorkflowForTrigger: vi.fn(async () => false),
}))
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn(async () => {}),
  emitTicketStatusChanged: vi.fn(async () => {}),
  emitTicketAssigned: vi.fn(async () => {}),
  emitTicketReplied: spies.emitTicketReplied,
  emitTicketNoteAdded: vi.fn(async () => {}),
  emitTicketExternalStatusChanged: vi.fn(async () => {}),
}))

import { sendAgentMessage } from '@/lib/server/domains/conversation/conversation.service'
import { emitPairTicketReplied } from '../ticket-message.service'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'

const fixture = await createDbTestFixture()

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')

let teammate: PrincipalId
let apiKey: PrincipalId
let customer: PrincipalId

function teammateActor(principalId: PrincipalId): Actor {
  return { principalId, principalType: 'user', role: 'admin', segmentIds: new Set() }
}

async function pairedTicket(): Promise<{ ticketId: TicketId; conversationId: ConversationId }> {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `open-${suffix()}`, category: 'open' })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      title: 'Cannot export',
      statusId: status!.id,
      type: 'customer',
      requesterPrincipalId: customer,
      updatedAt: LONG_AGO,
    })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger', status: 'open' })
    .returning()
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticket!.id, conversationId: conversation!.id, ticketType: 'customer' })
  return { ticketId: ticket!.id, conversationId: conversation!.id }
}

async function watchReason(ticketId: TicketId, principalId: PrincipalId) {
  const [row] = await testDb
    .select({ reason: ticketSubscriptions.reason })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, principalId)
      )
    )
  return row?.reason ?? null
}

async function updatedAtOf(ticketId: TicketId): Promise<Date> {
  const [row] = await testDb
    .select({ updatedAt: tickets.updatedAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row!.updatedAt
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  const userId = createId('user')
  teammate = createId('principal')
  apiKey = createId('principal')
  customer = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Alex', email: `${userId}@acme.test` })
  await testDb.insert(principal).values([
    {
      id: teammate,
      userId,
      type: 'user',
      role: 'admin',
      displayName: 'Alex',
      createdAt: new Date(),
    },
    { id: apiKey, type: 'service', role: 'admin', displayName: 'Key', createdAt: new Date() },
    { id: customer, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('a teammate reply typed in the inbox on a ticket conversation', () => {
  it('makes the replier a watcher and marks the ticket updated, with one ticket.replied', async () => {
    const { ticketId, conversationId } = await pairedTicket()

    const { message } = await sendAgentMessage(
      conversationId,
      'Looking into it now',
      { principalId: teammate, displayName: 'Alex' },
      teammateActor(teammate)
    )

    // Runs just after the send returns, off its path.
    await vi.waitFor(() => expect(spies.emitTicketReplied).toHaveBeenCalledTimes(1))
    expect(await watchReason(ticketId, teammate)).toBe('replier')
    expect((await updatedAtOf(ticketId)).getTime()).toBe(new Date(message.createdAt).getTime())
  })

  it('does not make an API key a watcher, but still marks the ticket updated', async () => {
    const { ticketId, conversationId } = await pairedTicket()
    const actor = serviceActorFromApiAuth({
      principalId: apiKey,
      role: 'admin',
      permissions: new Set([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.CONVERSATION_REPLY]),
    })

    await sendAgentMessage(conversationId, 'Automated update', { principalId: apiKey }, actor)

    await vi.waitFor(() => expect(spies.emitTicketReplied).toHaveBeenCalledTimes(1))
    expect(await watchReason(ticketId, apiKey)).toBeNull()
    expect((await updatedAtOf(ticketId)).getTime()).toBeGreaterThan(LONG_AGO.getTime())
  })
})

describe('a customer message on a ticket conversation', () => {
  function customerActor(principalId: PrincipalId): Actor {
    return { principalId, principalType: 'anonymous', role: 'user', segmentIds: new Set() }
  }
  const customerMessage = {
    senderType: 'visitor',
    createdAt: new Date().toISOString(),
  } as ConversationMessageDTO

  it('makes the requester who replied a watcher again, as a reply from the ticket view does', async () => {
    const { ticketId, conversationId } = await pairedTicket()
    expect(await watchReason(ticketId, customer)).toBeNull()

    await emitPairTicketReplied(conversationId, customerActor(customer), customerMessage)

    expect(await watchReason(ticketId, customer)).toBe('requester')
    expect(spies.emitTicketReplied).toHaveBeenCalledTimes(1)
  })

  it('leaves an existing watch, its reason and its mute alone', async () => {
    const { ticketId, conversationId } = await pairedTicket()
    const mutedUntil = new Date(Date.now() + 60 * 60 * 1000)
    await testDb
      .insert(ticketSubscriptions)
      .values({ ticketId, principalId: customer, reason: 'manual', mutedUntil })

    await emitPairTicketReplied(conversationId, customerActor(customer), customerMessage)

    const [row] = await testDb
      .select()
      .from(ticketSubscriptions)
      .where(
        and(
          eq(ticketSubscriptions.ticketId, ticketId),
          eq(ticketSubscriptions.principalId, customer)
        )
      )
    expect(row?.reason).toBe('manual')
    expect(row?.mutedUntil?.getTime()).toBe(mutedUntil.getTime())
  })
})
