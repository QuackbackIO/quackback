/**
 * Real-DB coverage for the conversation-link side of the create-ticket flow
 * (unified inbox §M5): inserting the `ticket_conversations` row, the friendly
 * conflict on a second link attempt (the partial-unique indexes and the
 * composite primary key), the system-event announcement posted onto the
 * conversation thread, and the split between a CUSTOMER link (the pair: shared
 * thread, first-response backfill, SLA handoff, customer-visible marker) and a
 * non-customer link (provenance: the join row plus a team-only note, nothing
 * else). Runs inside the fixture rollback.
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
  publishAgentConversationEvent: vi.fn(),
}))

import {
  publishConversationEvent,
  publishAgentConversationEvent,
} from '@/lib/server/realtime/conversation-channels'
import { createTicket } from '../ticket.service'
import { linkTicketToConversation } from '../ticket-conversation-link.service'
import { ConflictError } from '@/lib/shared/errors'
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
    vi.mocked(publishConversationEvent).mockClear()

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
    // The pair's conversion marker is customer-visible on the shared thread —
    // stored non-internal and broadcast on the visitor's own channel.
    expect(announcements[0].isInternal).toBe(false)
    expect(announcements[0].content).toContain(ticket.reference)
    expect(publishConversationEvent).toHaveBeenCalledTimes(1)
  })

  // --- Non-customer links: provenance only (the pair semantics stay
  // customer-only). A back-office ticket spun off a conversation keeps the
  // conversation it came from, and the customer never learns of it. ---

  it('links a back-office ticket to the conversation it was created from', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
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
    // The denormalized type is the ticket's own — a back-office link must not
    // masquerade as the conversation's customer pair.
    expect(link.ticketType).toBe('back_office')
  })

  it('announces a back-office ticket as a team-only note, never to the customer', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket(
      { type: 'back_office', title: 'Check the billing job' },
      actor
    )
    const conversationId = await seedConversation()
    vi.mocked(publishConversationEvent).mockClear()
    vi.mocked(publishAgentConversationEvent).mockClear()

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [note] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    expect(note.senderType).toBe('system')
    expect(note.isInternal).toBe(true)
    expect(note.content).toContain(ticket.reference)
    // Both halves of the team-only rule: the stored row every visitor read
    // path filters, and the broadcast that never touches the visitor's own
    // conversation channel.
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('leaves the customer pair free after a back-office link', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const backOffice = await createTicket({ type: 'back_office', title: 'Side task' }, actor)
    const customer = await createTicket({ type: 'customer', title: 'The ask' }, actor)
    const conversationId = await seedConversation()

    await linkTicketToConversation(backOffice.id, conversationId, actor)
    // The 1:1 partial uniques are customer-only, so the conversation can still
    // take its pair after carrying a context link.
    await linkTicketToConversation(customer.id, conversationId, actor)

    const links = await testDb
      .select()
      .from(ticketConversations)
      .where(eq(ticketConversations.conversationId, conversationId))
    expect(links.map((l) => l.ticketType).sort()).toEqual(['back_office', 'customer'])
  })

  it('links one back-office ticket to several conversations (the 1:1 is customer-only)', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Shared task' }, actor)
    const firstConversationId = await seedConversation()
    const secondConversationId = await seedConversation()

    await linkTicketToConversation(ticket.id, firstConversationId, actor)
    await linkTicketToConversation(ticket.id, secondConversationId, actor)

    const links = await testDb
      .select()
      .from(ticketConversations)
      .where(eq(ticketConversations.ticketId, ticket.id))
    expect(links).toHaveLength(2)
  })

  it('surfaces a friendly conflict when the same pair is linked twice', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Double click' }, actor)
    const conversationId = await seedConversation()

    await linkTicketToConversation(ticket.id, conversationId, actor)

    // No partial unique covers a non-customer link, so the composite primary
    // key is what a repeat trips — it still reads as ALREADY_LINKED.
    const err = await linkTicketToConversation(ticket.id, conversationId, actor).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).code).toBe('ALREADY_LINKED')
  })

  it('does not backfill first_response_at on a back-office ticket', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    await testDb.insert(conversationMessages).values({
      conversationId,
      principalId: actor.principalId,
      senderType: 'agent',
      content: 'reply to the customer',
      createdAt: new Date('2026-07-01T10:00:00Z'),
    })
    const ticket = await createTicket({ type: 'back_office', title: 'Internal follow-up' }, actor)

    await linkTicketToConversation(ticket.id, conversationId, actor)

    // The conversation's response answered the CUSTOMER, not this internal
    // task — the back-office ticket's own response clock stays unstarted.
    const [row] = await testDb
      .select({ firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.firstResponseAt).toBeNull()
  })

  it("does not hand the conversation's SLA to a back-office ticket", async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    const policy = await createSlaPolicy({ name: 'Resolve fast', timeToResolveTargetSecs: 7200 })
    await applySlaToConversation(conversationId, policy.id, new Date('2026-01-05T10:00:00Z'))
    const ticket = await createTicket({ type: 'back_office', title: 'Internal chase' }, actor)

    await linkTicketToConversation(ticket.id, conversationId, actor)

    // The conversation keeps the customer promise: an internal task must not
    // start a second clock against it.
    const [row] = await testDb
      .select({ slaApplied: tickets.slaApplied })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.slaApplied).toBeNull()
    const events = await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticket.id))
    expect(events).toHaveLength(0)
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

  it('surfaces a friendly conflict when the TICKET is already linked (1:1 pair, 0214)', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'customer', title: 'Linked once' }, actor)
    const firstConversationId = await seedConversation()
    const secondConversationId = await seedConversation()

    await linkTicketToConversation(ticket.id, firstConversationId, actor)

    // Convergence Phase 0: the pair is 1:1, so re-linking the same ticket to
    // ANOTHER conversation trips 0214's ticket-side partial unique index, and
    // the guard translates it into the same ALREADY_LINKED ConflictError shape
    // as the conversation-side race.
    const err = await linkTicketToConversation(ticket.id, secondConversationId, actor).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).code).toBe('ALREADY_LINKED')
    expect((err as Error).message).toMatch(/already linked/i)
  })

  // --- Phase 1a firstResponseAt rule (convergence-design.md, mechanics
  // appendix "Write (Phase 1)"): backfill at link time from the conversation's
  // first agent message; afterwards the conversation owns the timeline. ---

  it("backfills the ticket's first_response_at from the conversation's first agent message at link time", async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    // Two agent messages: the EARLIEST is the first response (internal notes
    // don't count, but both here are customer-visible).
    const firstAt = new Date('2026-07-01T10:00:00Z')
    const secondAt = new Date('2026-07-02T10:00:00Z')
    await testDb.insert(conversationMessages).values([
      {
        conversationId,
        principalId: actor.principalId,
        senderType: 'agent',
        content: 'first reply',
        createdAt: firstAt,
      },
      {
        conversationId,
        principalId: actor.principalId,
        senderType: 'agent',
        content: 'second reply',
        createdAt: secondAt,
      },
    ])
    const ticket = await createTicket({ type: 'customer', title: 'Linked after replies' }, actor)
    expect(ticket.firstResponseAt).toBeNull()

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await testDb
      .select({ firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.firstResponseAt).toEqual(firstAt)
  })

  it('ignores internal notes and visitor messages when backfilling first_response_at', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    await testDb.insert(conversationMessages).values([
      {
        conversationId,
        principalId: actor.principalId,
        senderType: 'agent',
        isInternal: true,
        content: 'a private note',
        createdAt: new Date('2026-07-01T09:00:00Z'),
      },
      {
        conversationId,
        principalId: null,
        senderType: 'visitor',
        content: 'customer ask',
        createdAt: new Date('2026-07-01T09:30:00Z'),
      },
    ])
    const ticket = await createTicket({ type: 'customer', title: 'Only notes so far' }, actor)

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await testDb
      .select({ firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.firstResponseAt).toBeNull()
  })

  it('never overwrites an existing first_response_at at link time', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const conversationId = await seedConversation()
    await testDb.insert(conversationMessages).values({
      conversationId,
      principalId: actor.principalId,
      senderType: 'agent',
      content: 'earlier conversation reply',
      createdAt: new Date('2026-07-01T10:00:00Z'),
    })
    const ticket = await createTicket({ type: 'customer', title: 'Already answered' }, actor)
    // The ticket got its own agent response before being linked (stamped once,
    // never overwritten — ticket.lifecycle's firstResponseStamp rule).
    const stamped = new Date('2026-07-03T12:00:00Z')
    await testDb.update(tickets).set({ firstResponseAt: stamped }).where(eq(tickets.id, ticket.id))

    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await testDb
      .select({ firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
    expect(row.firstResponseAt).toEqual(stamped)
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
