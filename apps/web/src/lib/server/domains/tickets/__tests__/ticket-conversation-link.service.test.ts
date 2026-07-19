/**
 * Real-DB coverage for the conversation-link side of the create-ticket flow
 * (unified inbox §M5): inserting the `ticket_conversations` row, the
 * customer-only guard, the friendly conflict on a second link attempt (the
 * partial-unique index), and the system-event announcement posted onto the
 * conversation thread. Runs inside the fixture rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type ConversationId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  settings,
  ticketConversations,
  conversations,
  conversationMessages,
  slaEvents,
  user,
  principal,
  eq,
  and,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
}))

import { createTicket } from '../ticket.service'
import { linkTicketToConversation } from '../ticket-conversation-link.service'
import { createSlaPolicy } from '../../sla/sla-policy.service'
import { applySlaToConversation } from '../../sla/sla.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** An admin actor backed by a real principal row — required since the link
 *  row's `linked_by_principal_id` is an FK. */
async function seedAdminActor(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

async function seedStatuses(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
}

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedConversation(): Promise<ConversationId> {
  const visitorPrincipalId = await seedVisitor()
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })
  return conversationId
}

describe.skipIf(!fixture.available)('linkTicketToConversation (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('inserts the join row and announces the ticket on the conversation thread', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'customer', title: 'From a conversation' }, actor)
    const conversationId = await seedConversation()

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [link] = await testDb
      .select()
      .from(ticketConversations)
      .where(
        and(
          eq(ticketConversations.ticketId, ticket.id),
          eq(ticketConversations.conversationId, conversationId)
        )
      )
    expect(link).toBeDefined()
    expect(link.ticketType).toBe('customer')

    const announcements = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    expect(announcements).toHaveLength(1)
    expect(announcements[0].senderType).toBe('system')
    expect(announcements[0].content).toContain(ticket.reference)
  })

  it('rejects a non-customer ticket', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const conversationId = await seedConversation()

    await expect(linkTicketToConversation(ticket.id, conversationId, actor)).rejects.toThrow(
      /customer/i
    )
  })

  it('surfaces a friendly conflict when the conversation already has a linked ticket', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const first = await createTicket({ type: 'customer', title: 'First' }, actor)
    const second = await createTicket({ type: 'customer', title: 'Second' }, actor)
    const conversationId = await seedConversation()

    await linkTicketToConversation(first.id, conversationId, actor)

    await expect(linkTicketToConversation(second.id, conversationId, actor)).rejects.toThrow(
      /already/i
    )
  })

  // --- SLA handoff (support platform §4.6, "applied first time" semantics) ---

  it("starts the linked customer ticket's TTR clock when the conversation has a TTR-tracking SLA", async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({
      name: 'Resolve fast',
      timeToResolveTargetSecs: 7200,
    })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    const ticket = await createTicket(
      { type: 'customer', title: "From an SLA'd conversation" },
      actor
    )

    const before = Date.now()
    await linkTicketToConversation(ticket.id, conversationId, actor)
    const after = Date.now()

    const [row] = await testDb
      .select({ slaApplied: tickets.slaApplied })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    const stamp = row.slaApplied as {
      policyId: string
      policyName: string
      appliedAt: string
      timeToResolveDueAt: string
    } | null
    expect(stamp).not.toBeNull()
    expect(stamp!.policyId).toBe(policy.id)
    // The clock ticks from the LINK instant (not the ticket's creation or the
    // conversation's own application), 24/7: due = appliedAt + 2h.
    const appliedMs = new Date(stamp!.appliedAt).getTime()
    expect(appliedMs).toBeGreaterThanOrEqual(before)
    expect(appliedMs).toBeLessThanOrEqual(after)
    expect(new Date(stamp!.timeToResolveDueAt).getTime() - appliedMs).toBe(7200 * 1000)

    // Ticket-anchored 'applied' event on the shared timeline.
    const events = await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticket.id))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('applied')
    expect(events[0].conversationId).toBeNull()
  })

  it("does not stamp the ticket when the conversation's SLA policy tracks no TTR", async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    // A conversation-side-only policy (FRT/TTC, no time_to_resolve target).
    const policy = await createSlaPolicy({
      name: 'First response only',
      firstResponseTargetSecs: 3600,
    })
    await applySlaToConversation(conversationId, policy.id)
    const ticket = await createTicket({ type: 'customer', title: 'No TTR handoff' }, actor)

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await testDb
      .select({ slaApplied: tickets.slaApplied })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.slaApplied).toBeNull()
    const events = await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticket.id))
    expect(events).toHaveLength(0)
  })

  it('does not stamp the ticket when the conversation has no SLA at all', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    const ticket = await createTicket({ type: 'customer', title: 'Plain link' }, actor)

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await testDb
      .select({ slaApplied: tickets.slaApplied })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.slaApplied).toBeNull()
  })
})
