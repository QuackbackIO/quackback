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
// otherwise resolve hook targets against Redis/db mid-rollback).
vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
}))
// config getters validate the full env (absent in tests); the ticket create
// path's attachment-url check only reads these two.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  tickets,
  ticketStatuses,
  ticketConversations,
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
        statusName: linkedTicket.status.name,
        statusCategory: linkedTicket.status.category,
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
      const closedTicket = await setTicketStatus(closedTicketDraft.id, closed.id, writeActor())

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
  })
})
