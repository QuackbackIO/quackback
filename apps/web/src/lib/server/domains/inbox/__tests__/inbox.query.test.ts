/**
 * Real-DB coverage for the unified inbox union query (UNIFIED-INBOX-SPEC.md
 * §3.1): RBAC branch-skipping, the one-row rule, facet mapping, and keyset
 * cursor stability under a concurrent insert. Runs inside the db-test-fixture
 * rollback transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize the ticket domain's fire-and-forget webhook bridge (it would
// otherwise resolve hook targets against the cache/db mid-rollback).
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketUpdated: vi.fn().mockResolvedValue(undefined),
  emitTicketPriorityChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
}))
// config getters validate the full env (absent in tests); the ticket create
// path's attachment-url check only reads these two.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
// Neutralize the ticket domain's realtime publish (unified inbox §3.2, M3):
// createTicket/setTicketStatus now fire it too, and it would otherwise touch
// the real (unconfigured-in-tests) pub/sub connection mid-rollback.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({ publishTicketEvent: vi.fn() }))
// Neutralize the ticket activity log: this suite's write actors are unbacked
// principal ids, and a real insert's FK failure would abort the fixture's
// shared transaction. Covered in ticket-activity.service.test.ts instead.
vi.mock('@/lib/server/domains/tickets/ticket-activity.service', () => ({
  recordTicketActivity: vi.fn(),
  recordTicketActivityAwaited: vi.fn().mockResolvedValue(undefined),
  listTicketActivity: vi.fn().mockResolvedValue([]),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  tickets,
  ticketStatuses,
  ticketConversations,
  ticketSubscriptions,
  principal,
  user,
  settings,
  eq,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { listInboxItems, countInboxScopes } from '../inbox.query'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function buildActor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>(),
    ...overrides,
  }
}

function serviceActor(): Actor {
  return buildActor({ principalId: createId('principal') as PrincipalId, principalType: 'service' })
}

/** A full-permission actor for seeding fixtures (createTicket/setTicketStatus
 *  gate on specific write permissions, unlike the read-only actors above). */
function writeActor(): Actor {
  return buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    permissions: resolveActorPermissions('admin'),
  })
}

function conversationOnlyActor(): Actor {
  return buildActor({
    principalId: createId('principal') as PrincipalId,
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]),
  })
}

function ticketOnlyActor(): Actor {
  return buildActor({
    principalId: createId('principal') as PrincipalId,
    permissions: new Set([PERMISSIONS.TICKET_VIEW_ALL]),
  })
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** A deterministic open + closed status, all rolled back. */
async function seedStatuses() {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Open',
      slug: `t_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Closed',
      slug: `t_closed_${suffix()}`,
      category: 'closed',
      position: 101,
      isDefault: false,
      publicStage: 'resolved',
    })
    .returning()
  return { open, closed }
}

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'anonymous', createdAt: new Date() })
  return principalId
}

/** A real, DB-backed teammate principal — required whenever a foreign key
 *  (e.g. `conversations.assigned_agent_principal_id`) must resolve. */
async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedConversation(
  visitorPrincipalId: PrincipalId,
  over: { lastMessageAt?: Date; status?: 'open' | 'snoozed' | 'closed' } = {}
): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({
    id,
    visitorPrincipalId,
    channel: 'messenger',
    lastMessageAt: over.lastMessageAt ?? new Date(),
    status: over.status ?? 'open',
  })
  return id
}

async function linkTicketToConversation(ticketId: string, conversationId: ConversationId) {
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticketId as never, conversationId, ticketType: 'customer' })
}

describe.skipIf(!fixture.available)('inbox.query (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('skips the ticket branch entirely for a conversation-only actor', async () => {
    await seedSettings()
    await seedStatuses()
    const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    const visitor = await seedVisitor()
    const conversationId = await seedConversation(visitor)
    await createTicket({ type: 'customer', title: 'Unrelated ticket' }, writeActor())

    const page = await listInboxItems(conversationOnlyActor(), { facet: 'all', limit: 10 })
    expect(page.items.every((i) => i.kind === 'conversation')).toBe(true)
    expect(
      page.items.some((i) => i.kind === 'conversation' && i.conversation.id === conversationId)
    ).toBe(true)
  })

  it('skips the conversation branch entirely for a ticket-only actor', async () => {
    await seedSettings()
    await seedStatuses()
    const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
    const visitor = await seedVisitor()
    await seedConversation(visitor)
    const ticket = await createTicket({ type: 'customer', title: 'A ticket' }, writeActor())

    const page = await listInboxItems(ticketOnlyActor(), { facet: 'all', limit: 10 })
    expect(page.items.every((i) => i.kind === 'ticket')).toBe(true)
    expect(page.items.some((i) => i.kind === 'ticket' && i.ticket.id === ticket.id)).toBe(true)
  })

  describe('one-row rule', () => {
    it('a conversation with a linked customer ticket appears once, wearing the ticket chip', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const conversationId = await seedConversation(visitor)
      const linkedTicket = await createTicket({ type: 'customer', title: 'Linked' }, writeActor())
      await linkTicketToConversation(linkedTicket.id, conversationId)

      const page = await listInboxItems(serviceActor(), { facet: 'all', limit: 20 })

      const conversationRow = page.items.find(
        (i) => i.kind === 'conversation' && i.conversation.id === conversationId
      )
      expect(conversationRow).toBeDefined()
      expect(conversationRow?.kind === 'conversation' && conversationRow.linkedTicket).toEqual({
        id: linkedTicket.id,
        number: linkedTicket.number,
        // The chip renders the title alongside the number
        // (conversation-list-column.tsx), so it is part of the summary.
        title: linkedTicket.title,
        statusName: linkedTicket.status.name,
        statusCategory: linkedTicket.status.category,
        dueAt: null,
      })

      // The ticket's OWN row must not also appear.
      const ticketRow = page.items.find(
        (i) => i.kind === 'ticket' && i.ticket.id === linkedTicket.id
      )
      expect(ticketRow).toBeUndefined()
    })

    it('an unlinked customer ticket appears as its own ticket row', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const unlinked = await createTicket({ type: 'customer', title: 'Standalone' }, writeActor())

      const page = await listInboxItems(serviceActor(), { facet: 'all', limit: 20 })
      const row = page.items.find((i) => i.kind === 'ticket' && i.ticket.id === unlinked.id)
      expect(row).toBeDefined()
    })
  })

  describe('facet mapping', () => {
    it('the open facet excludes closed conversations and closed-category tickets', async () => {
      await seedSettings()
      const { closed } = await seedStatuses()
      const { createTicket, setTicketStatus } =
        await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const openConversation = await seedConversation(visitor, { status: 'open' })
      const closedConversation = await seedConversation(visitor, { status: 'closed' })
      const openTicket = await createTicket(
        { type: 'customer', title: 'Open ticket' },
        writeActor()
      )
      const closedTicketDraft = await createTicket(
        { type: 'customer', title: 'Closed ticket' },
        writeActor()
      )
      // A status move records its actor in the same write, so the actor must exist.
      const closedTicket = await setTicketStatus(
        closedTicketDraft.id,
        closed.id,
        buildActor({
          principalId: await seedTeammate(),
          role: 'admin',
          permissions: resolveActorPermissions('admin'),
        })
      )

      const page = await listInboxItems(serviceActor(), { facet: 'open', limit: 50 })
      const ids = page.items.map((i) =>
        i.kind === 'conversation' ? i.conversation.id : i.ticket.id
      )
      expect(ids).toContain(openConversation)
      expect(ids).toContain(openTicket.id)
      expect(ids).not.toContain(closedConversation)
      expect(ids).not.toContain(closedTicket.id)
    })
  })

  describe('cursor stability under a concurrent insert', () => {
    it('pages through conversations without dupes or skips when a row is inserted mid-pagination', async () => {
      await seedSettings()
      const visitor = await seedVisitor()
      const a = await seedConversation(visitor, {
        lastMessageAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      const b = await seedConversation(visitor, {
        lastMessageAt: new Date('2026-01-02T00:00:00.000Z'),
      })
      const c = await seedConversation(visitor, {
        lastMessageAt: new Date('2026-01-03T00:00:00.000Z'),
      })

      const page1 = await listInboxItems(serviceActor(), {
        facet: 'all',
        limit: 2,
        kinds: ['conversation'],
      })
      expect(
        page1.items.map((i) => (i.kind === 'conversation' ? i.conversation.id : null))
      ).toEqual([c, b])
      expect(page1.cursor).not.toBeNull()

      // Concurrent insert: a brand-new conversation, newer than everything
      // already paged, arrives between page 1 and page 2.
      await seedConversation(visitor, { lastMessageAt: new Date('2026-01-10T00:00:00.000Z') })

      const page2 = await listInboxItems(serviceActor(), {
        facet: 'all',
        limit: 2,
        kinds: ['conversation'],
        cursor: page1.cursor ?? undefined,
      })
      // Page 2 continues strictly after `b` (the last row page 1 emitted) —
      // the new, newer row landed "above" the cursor and never appears here,
      // and `a` is neither skipped nor duplicated.
      expect(
        page2.items.map((i) => (i.kind === 'conversation' ? i.conversation.id : null))
      ).toEqual([a])
      expect(page2.cursor).toBeNull()
    })
  })

  describe('the SLA breach soonest sort', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString()
    const conversationStamp = (firstResponseDueAt: string) => ({
      policyId: 'sla_policy_test',
      policyName: 'Standard',
      appliedAt: at(0),
      firstResponseDueAt,
      nextResponseTargetSecs: null,
      timeToCloseDueAt: null,
    })
    const ticketStamp = (timeToResolveDueAt: string, resolvedAt: string | null = null) => ({
      policyId: 'sla_policy_test',
      policyName: 'Standard',
      appliedAt: at(0),
      timeToResolveDueAt,
      resolvedAt,
    })
    const idOf = (item: Awaited<ReturnType<typeof listInboxItems>>['items'][number]) =>
      item.kind === 'conversation' ? item.conversation.id : item.ticket.id

    it('ranks conversations and tickets by their nearest unmet deadline, unmet clocks last, across pages', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()

      // Activity order is the reverse of deadline order, so a list that
      // silently fell back to "most recent" would fail every assertion.
      const conversationDue10 = await seedConversation(visitor, { lastMessageAt: new Date(at(50)) })
      const conversationDue30 = await seedConversation(visitor, { lastMessageAt: new Date(at(49)) })
      const conversationNoSla = await seedConversation(visitor, { lastMessageAt: new Date(at(59)) })
      await testDb
        .update(conversations)
        .set({ slaApplied: conversationStamp(at(10)) as never })
        .where(eq(conversations.id, conversationDue10))
      await testDb
        .update(conversations)
        .set({ slaApplied: conversationStamp(at(30)) as never })
        .where(eq(conversations.id, conversationDue30))

      const ticketDue20 = await createTicket(
        { type: 'back_office', title: 'Due at 20' },
        writeActor()
      )
      const ticketDue40 = await createTicket(
        { type: 'back_office', title: 'Due at 40' },
        writeActor()
      )
      const ticketSettled = await createTicket(
        { type: 'back_office', title: 'Resolved within its SLA' },
        writeActor()
      )
      await testDb
        .update(tickets)
        .set({ slaApplied: ticketStamp(at(20)), updatedAt: new Date(at(1)) })
        .where(eq(tickets.id, ticketDue20.id))
      await testDb
        .update(tickets)
        .set({ slaApplied: ticketStamp(at(40)), updatedAt: new Date(at(2)) })
        .where(eq(tickets.id, ticketDue40.id))
      // A settled clock has nothing left to breach: it sorts with the rows
      // that carry no SLA at all, however early its old deadline was.
      await testDb
        .update(tickets)
        .set({ slaApplied: ticketStamp(at(5), at(4)), updatedAt: new Date(at(3)) })
        .where(eq(tickets.id, ticketSettled.id))

      const filter = {
        facet: 'all' as const,
        kinds: ['conversation', 'ticket'] as Array<'conversation' | 'ticket'>,
        sort: 'sla' as const,
        limit: 3,
      }
      const page1 = await listInboxItems(serviceActor(), filter)
      expect(page1.items.map(idOf)).toEqual([conversationDue10, ticketDue20.id, conversationDue30])
      expect(page1.cursor).not.toBeNull()

      const page2 = await listInboxItems(serviceActor(), {
        ...filter,
        cursor: page1.cursor ?? undefined,
      })
      // The deadline-less rows follow every live deadline, conversation
      // before ticket, without a duplicate or a skip at the page boundary.
      expect(page2.items.map(idOf)).toEqual([ticketDue40.id, conversationNoSla, ticketSettled.id])
      expect(page2.cursor).toBeNull()
    })

    /** Walk every page with the real cursor; the ids in emitted order. */
    async function walkAllPages(limit: number): Promise<string[]> {
      const seen: string[] = []
      let cursor: string | undefined
      for (let pages = 0; pages < 20; pages++) {
        const page = await listInboxItems(serviceActor(), {
          facet: 'all',
          kinds: ['conversation', 'ticket'],
          sort: 'sla',
          limit,
          cursor,
        })
        seen.push(...page.items.map(idOf))
        if (!page.cursor) return seen
        cursor = page.cursor
      }
      throw new Error('paging never ended')
    }

    it('pages a long no-deadline tail of both kinds exactly once each', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()

      // Each row is newer in activity than the one created after it, so the
      // activity order runs opposite to the id order the null tail pages by.
      const conversationIds: string[] = []
      for (let i = 0; i < 5; i++) {
        conversationIds.push(
          await seedConversation(visitor, { lastMessageAt: new Date(at(50 - i)) })
        )
      }
      const ticketIds: string[] = []
      for (let i = 0; i < 5; i++) {
        const ticket = await createTicket(
          { type: 'back_office', title: `No deadline ${i}` },
          writeActor()
        )
        await testDb
          .update(tickets)
          .set({ updatedAt: new Date(at(40 - i)) })
          .where(eq(tickets.id, ticket.id))
        ticketIds.push(ticket.id)
      }

      const seen = await walkAllPages(3)
      expect(seen).toHaveLength(10)
      expect(new Set(seen).size).toBe(10)
      expect([...seen].sort()).toEqual([...conversationIds, ...ticketIds].sort())
      // The tail runs conversations then tickets, each kind in id order.
      expect(seen).toEqual([...[...conversationIds].sort(), ...[...ticketIds].sort()])
    })

    it('pages rows that share a deadline across a page boundary exactly once each', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()

      const conversationEarly = await seedConversation(visitor, { lastMessageAt: new Date(at(1)) })
      const conversationTiedA = await seedConversation(visitor, { lastMessageAt: new Date(at(9)) })
      const conversationTiedB = await seedConversation(visitor, { lastMessageAt: new Date(at(8)) })
      await testDb
        .update(conversations)
        .set({ slaApplied: conversationStamp(at(5)) as never })
        .where(eq(conversations.id, conversationEarly))
      for (const id of [conversationTiedA, conversationTiedB]) {
        await testDb
          .update(conversations)
          .set({ slaApplied: conversationStamp(at(20)) as never })
          .where(eq(conversations.id, id))
      }
      const ticketTied = await createTicket({ type: 'back_office', title: 'Tied' }, writeActor())
      const ticketLater = await createTicket({ type: 'back_office', title: 'Later' }, writeActor())
      await testDb
        .update(tickets)
        .set({ slaApplied: ticketStamp(at(20)), updatedAt: new Date(at(30)) })
        .where(eq(tickets.id, ticketTied.id))
      await testDb
        .update(tickets)
        .set({ slaApplied: ticketStamp(at(25)), updatedAt: new Date(at(31)) })
        .where(eq(tickets.id, ticketLater.id))

      // Pages of 2 split the three rows due at :20 across a boundary.
      const seen = await walkAllPages(2)
      const tiedConversations = [conversationTiedA, conversationTiedB].sort()
      expect(seen).toEqual([
        conversationEarly,
        tiedConversations[0],
        tiedConversations[1],
        ticketTied.id,
        ticketLater.id,
      ])
      expect(new Set(seen).size).toBe(seen.length)
    })
  })

  describe('the waiting longest sort', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes))
    const idOf = (item: Awaited<ReturnType<typeof listInboxItems>>['items'][number]) =>
      item.kind === 'conversation' ? item.conversation.id : item.ticket.id

    /** Walk every page with the real cursor; the ids in emitted order. */
    async function walkAllPages(limit: number): Promise<string[]> {
      const seen: string[] = []
      let cursor: string | undefined
      for (let pages = 0; pages < 20; pages++) {
        const page = await listInboxItems(serviceActor(), {
          facet: 'all',
          kinds: ['conversation', 'ticket'],
          sort: 'waiting',
          limit,
          cursor,
        })
        seen.push(...page.items.map(idOf))
        if (!page.cursor) return seen
        cursor = page.cursor
      }
      throw new Error('paging never ended')
    }

    it('lists waiting conversations longest first, then the rest, then tickets by id, each exactly once', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()

      // Waiting order (:10, :20, :30) differs from both creation (id) order
      // and activity order, so a list sorted by either would fail.
      const waiting: Record<number, ConversationId> = {}
      for (const [since, activity] of [
        [30, 59],
        [10, 41],
        [20, 50],
      ] as const) {
        const id = await seedConversation(visitor, { lastMessageAt: at(activity) })
        await testDb
          .update(conversations)
          .set({ waitingSince: at(since) })
          .where(eq(conversations.id, id))
        waiting[since] = id
      }
      // Nobody is waiting on these; they are the most recently active rows.
      const idle = [
        await seedConversation(visitor, { lastMessageAt: at(58) }),
        await seedConversation(visitor, { lastMessageAt: at(57) }),
      ]
      // Tickets have no waiting clock. Activity runs opposite to id order.
      const ticketIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const ticket = await createTicket(
          { type: 'back_office', title: `Ticket ${i}` },
          writeActor()
        )
        await testDb
          .update(tickets)
          .set({ updatedAt: at(56 - i) })
          .where(eq(tickets.id, ticket.id))
        ticketIds.push(ticket.id)
      }

      const expected = [
        waiting[10],
        waiting[20],
        waiting[30],
        ...[...idle].sort(),
        ...[...ticketIds].sort(),
      ]
      // Pages of 2 split the waiting/idle boundary and the conversation/ticket
      // boundary; pages of 3 land a boundary between pages instead.
      for (const limit of [2, 3]) {
        const seen = await walkAllPages(limit)
        expect(seen).toEqual(expected)
        expect(new Set(seen).size).toBe(seen.length)
      }
    })
  })

  describe('countInboxScopes', () => {
    it('counts open mine/unassigned conversations and open tickets by type, RBAC-bounded', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const agentPrincipalId = await seedTeammate()
      const actor = buildActor({
        principalId: agentPrincipalId,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL, PERMISSIONS.TICKET_VIEW_ALL]),
      })

      await testDb.insert(conversations).values({
        id: createId('conversation') as ConversationId,
        visitorPrincipalId: visitor,
        channel: 'messenger',
        assignedAgentPrincipalId: actor.principalId as never,
        status: 'open',
      })
      await testDb.insert(conversations).values({
        id: createId('conversation') as ConversationId,
        visitorPrincipalId: visitor,
        channel: 'messenger',
        status: 'open', // unassigned
      })
      await createTicket({ type: 'customer', title: 'Customer ticket' }, writeActor())
      await createTicket({ type: 'back_office', title: 'Back office ticket' }, writeActor())
      await createTicket({ type: 'tracker', title: 'Tracker ticket' }, writeActor())

      const counts = await countInboxScopes(actor)
      expect(counts.mine).toBe(1)
      expect(counts.unassigned).toBe(1)
      expect(counts.ticketsByType).toEqual({ customer: 1, back_office: 1, tracker: 1 })
    })

    it('a conversation-only actor gets zero ticket counts without querying tickets', async () => {
      await seedSettings()
      await seedStatuses()
      const counts = await countInboxScopes(conversationOnlyActor())
      expect(counts.ticketsByType).toEqual({ customer: 0, back_office: 0, tracker: 0 })
    })

    it('a linked pair counts ONCE in the customer bucket — as its conversation (Phase 2)', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const actor = buildActor({
        principalId: createId('principal') as PrincipalId,
        permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL, PERMISSIONS.TICKET_VIEW_ALL]),
      })

      // One pair (open conversation + linked open customer ticket), one
      // standalone open customer ticket, one open back-office ticket.
      const pairConversation = await seedConversation(visitor)
      const pairTicket = await createTicket({ type: 'customer', title: 'Pair' }, writeActor())
      await linkTicketToConversation(pairTicket.id, pairConversation)
      await createTicket({ type: 'customer', title: 'Standalone' }, writeActor())
      await createTicket({ type: 'back_office', title: 'BO' }, writeActor())

      const counts = await countInboxScopes(actor)
      // customer = 1 pair (as its conversation) + 1 standalone — NOT 3.
      expect(counts.ticketsByType).toEqual({ customer: 2, back_office: 1, tracker: 0 })

      // A closed pair conversation drops out of the badge (the badge tracks
      // the converged view's open rows).
      await testDb
        .update(conversations)
        .set({ status: 'closed' })
        .where(eq(conversations.id, pairConversation))
      const after = await countInboxScopes(actor)
      expect(after.ticketsByType.customer).toBe(1)
    })
  })

  describe('due date filter + sort (both branches)', () => {
    const HOUR = 60 * 60 * 1000

    async function setDueAt(ticketId: string, dueAt: Date | null) {
      await testDb
        .update(tickets)
        .set({ dueAt })
        .where(eq(tickets.id, ticketId as never))
    }

    /** A pair whose linked ticket is overdue, a standalone overdue ticket, a
     *  standalone ticket due later, an undated standalone, and a plain
     *  conversation. */
    async function seedDueFixtures() {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const now = Date.now()
      const visitor = await seedVisitor()
      const pairConversation = await seedConversation(visitor)
      const pairTicket = await createTicket({ type: 'customer', title: 'Pair' }, writeActor())
      await linkTicketToConversation(pairTicket.id, pairConversation)
      await setDueAt(pairTicket.id, new Date(now - 2 * HOUR))
      const overdue = await createTicket({ type: 'customer', title: 'Overdue' }, writeActor())
      await setDueAt(overdue.id, new Date(now - HOUR))
      const later = await createTicket({ type: 'customer', title: 'Later' }, writeActor())
      await setDueAt(later.id, new Date(now + 72 * HOUR))
      const undated = await createTicket({ type: 'customer', title: 'Undated' }, writeActor())
      const plainConversation = await seedConversation(visitor)
      return { pairConversation, pairTicket, overdue, later, undated, plainConversation }
    }

    const rowIds = (items: Awaited<ReturnType<typeof listInboxItems>>['items']) =>
      items.map((i) => (i.kind === 'conversation' ? i.conversation.id : i.ticket.id) as string)

    it('the overdue filter reaches a linked ticket through its conversation row and a standalone ticket', async () => {
      const f = await seedDueFixtures()

      const page = await listInboxItems(serviceActor(), {
        facet: 'all',
        due: 'overdue',
        limit: 100,
      })
      const ids = rowIds(page.items)

      expect(ids).toContain(f.pairConversation)
      expect(ids).toContain(f.overdue.id)
      expect(ids).not.toContain(f.pairTicket.id)
      expect(ids).not.toContain(f.later.id)
      expect(ids).not.toContain(f.undated.id)
      expect(ids).not.toContain(f.plainConversation)
      // The conversation row carries its linked ticket's date for the marker.
      const pairRow = page.items.find(
        (i) => i.kind === 'conversation' && i.conversation.id === f.pairConversation
      )
      expect(pairRow?.kind === 'conversation' && pairRow.linkedTicket?.dueAt).toBeTruthy()
    })

    it('the due sort merges both branches soonest first, undated rows after dated ones', async () => {
      const f = await seedDueFixtures()

      const page = await listInboxItems(serviceActor(), { facet: 'all', sort: 'due', limit: 100 })
      const ids = rowIds(page.items)
      const at = (id: string) => ids.indexOf(id)

      expect(at(f.pairConversation)).toBeGreaterThanOrEqual(0)
      expect(at(f.pairConversation)).toBeLessThan(at(f.overdue.id))
      expect(at(f.overdue.id)).toBeLessThan(at(f.later.id))
      expect(at(f.later.id)).toBeLessThan(at(f.undated.id))
      expect(at(f.later.id)).toBeLessThan(at(f.plainConversation))
    })
  })

  describe('alias semantics (convergence Phase 2)', () => {
    it('the customer-tickets scope lists the pair as its ONE conversation row, plus standalone tickets', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const pairConversation = await seedConversation(visitor)
      const pairTicket = await createTicket({ type: 'customer', title: 'Pair' }, writeActor())
      await linkTicketToConversation(pairTicket.id, pairConversation)
      const standalone = await createTicket({ type: 'customer', title: 'Standalone' }, writeActor())
      // A plain conversation (no linked ticket) must NOT surface in this scope.
      const plainConversation = await seedConversation(visitor)

      // The tickets_customer view's param shape (buildInboxListParams).
      const page = await listInboxItems(serviceActor(), {
        facet: 'all',
        kinds: ['conversation', 'ticket'],
        ticketType: 'customer',
        linkedPairsOnly: true,
        limit: 20,
      })

      const pairRow = page.items.find(
        (i) => i.kind === 'conversation' && i.conversation.id === pairConversation
      )
      expect(pairRow).toBeDefined()
      expect(pairRow?.kind === 'conversation' && pairRow.linkedTicket?.id).toBe(pairTicket.id)
      // The pair's ticket never gets a second row…
      expect(page.items.some((i) => i.kind === 'ticket' && i.ticket.id === pairTicket.id)).toBe(
        false
      )
      // …the standalone customer ticket keeps its own row…
      expect(page.items.some((i) => i.kind === 'ticket' && i.ticket.id === standalone.id)).toBe(
        true
      )
      // …and the plain conversation is out of scope.
      expect(
        page.items.some((i) => i.kind === 'conversation' && i.conversation.id === plainConversation)
      ).toBe(false)
    })

    it('the pair vanishes from the customer-tickets scope for a ticket-only actor (branch skip mirrors the badge)', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const pairConversation = await seedConversation(visitor)
      const pairTicket = await createTicket({ type: 'customer', title: 'Pair' }, writeActor())
      await linkTicketToConversation(pairTicket.id, pairConversation)
      const standalone = await createTicket({ type: 'customer', title: 'Standalone' }, writeActor())

      const page = await listInboxItems(ticketOnlyActor(), {
        facet: 'all',
        kinds: ['conversation', 'ticket'],
        ticketType: 'customer',
        linkedPairsOnly: true,
        limit: 20,
      })

      // No conversation branch for this actor: the pair has no row at all,
      // the standalone ticket still does.
      expect(page.items.every((i) => i.kind === 'ticket')).toBe(true)
      expect(page.items.some((i) => i.kind === 'ticket' && i.ticket.id === standalone.id)).toBe(
        true
      )
    })
  })

  describe('the Watching view', () => {
    it('lists only what the caller watches: a watched pair as its conversation row, a watched standalone ticket as its own', async () => {
      await seedSettings()
      await seedStatuses()
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const visitor = await seedVisitor()
      const watcher = await seedVisitor()

      const watchedPairConversation = await seedConversation(visitor)
      const watchedPair = await createTicket(
        { type: 'customer', title: 'Watched pair' },
        writeActor()
      )
      await linkTicketToConversation(watchedPair.id, watchedPairConversation)
      const otherPairConversation = await seedConversation(visitor)
      const otherPair = await createTicket({ type: 'customer', title: 'Other pair' }, writeActor())
      await linkTicketToConversation(otherPair.id, otherPairConversation)
      const watchedTracker = await createTicket(
        { type: 'tracker', title: 'Watched tracker' },
        writeActor()
      )
      const otherTicket = await createTicket({ type: 'customer', title: 'Other' }, writeActor())
      await testDb.insert(ticketSubscriptions).values([
        { ticketId: watchedPair.id, principalId: watcher, reason: 'manual' },
        {
          ticketId: watchedTracker.id,
          principalId: watcher,
          reason: 'manual',
          mutedUntil: new Date(Date.now() + 86_400_000),
        },
      ])

      // The tickets_watching view's param shape (buildInboxListParams).
      const page = await listInboxItems(
        buildActor({ principalId: watcher, principalType: 'service' }),
        {
          facet: 'all',
          kinds: ['conversation', 'ticket'],
          linkedPairsOnly: true,
          watching: true,
          limit: 20,
        }
      )
      const ids = page.items.map((i) =>
        i.kind === 'conversation' ? i.conversation.id : i.ticket.id
      )
      // A muted watch is still a watch.
      expect(new Set(ids)).toEqual(new Set([watchedPairConversation, watchedTracker.id]))
      expect(ids).not.toContain(otherPairConversation)
      expect(ids).not.toContain(otherTicket.id)
    })

    it('lists nothing for a caller with no identity', async () => {
      await seedSettings()
      await seedStatuses()
      const page = await listInboxItems(buildActor({ principalType: 'service' }), {
        facet: 'all',
        kinds: ['conversation', 'ticket'],
        linkedPairsOnly: true,
        watching: true,
        limit: 20,
      })
      expect(page.items).toEqual([])
    })
  })
})
