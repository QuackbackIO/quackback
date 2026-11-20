/**
 * Real-DB coverage for ticket visibility on every agent ticket write. A
 * teammate whose role grants team-scoped `ticket.view` writes only to tickets
 * assigned to them or to one of their teams. Every other ticket answers
 * NotFound, exactly like a missing one, and stays unchanged. The tracker
 * status cascade and the tracker reply-all are checked once, on the tracker,
 * and then reach every linked ticket with the teammate as author.
 *
 * Real here: the ticket writers, `ticketFilter` and the rows they read and
 * write. Stood in for: realtime fan-out, the webhook and notification
 * bridges, none of which decide visibility.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
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

vi.mock('../../conversation/conversation.webhooks', () => ({
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageNoteCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageDeleted: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationAssigned: vi.fn().mockResolvedValue(undefined),
  emitConversationPriorityChanged: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatSubmitted: vi.fn().mockResolvedValue(undefined),
  emitConversationCsatCommentAdded: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  conversationMessages,
  conversations,
  eq,
  inArray,
  principal,
  settings,
  teamMembers,
  teams,
  ticketActivity,
  ticketConversations,
  ticketLinks,
  tickets,
  ticketStatuses,
  user,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import {
  assignTicket,
  bulkUpdateTickets,
  setTicketPriority,
  setTicketStatus,
  softDeleteTicket,
} from '../ticket.service'
import { addTicketNote, sendTicketMessage } from '../ticket-message.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketLinks.trackerTicketId }).from(ticketLinks).limit(0)
    await db.select({ id: ticketActivity.id }).from(ticketActivity).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const NOT_FOUND = { code: 'TICKET_NOT_FOUND', statusCode: 404 }

const SCOPED_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_SET_STATUS,
  PERMISSIONS.TICKET_ASSIGN,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.TICKET_NOTE,
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
]

async function seedPerson(role: 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `P-${suffix()}`, email: `p-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function seedStatus(category: 'open' | 'pending' | 'closed'): Promise<TicketStatusId> {
  const id = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id, name: `Acme ${category}`, slug: `vw-${suffix()}`, category })
  return id
}

/** A scoped teammate in team X, an open, pending and closed status, and
 *  customer tickets on team X (visible) and team Y (hidden). */
async function seedWorld() {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
  const teammate = await seedPerson('member')
  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: teammate })
  const open = await seedStatus('open')
  const pending = await seedStatus('pending')

  async function ticket(team: TeamId, type: 'customer' | 'tracker' = 'customer') {
    const id = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id,
      title: `T-${suffix()}`,
      statusId: open,
      type,
      assigneeTeamId: team,
      priority: 'none',
    })
    return id
  }

  const actor: Actor = {
    principalId: teammate,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(SCOPED_PERMISSIONS),
  }
  return { teammate, teamX, teamY, open, pending, ticket, actor }
}

async function row(id: TicketId) {
  const [found] = await testDb.select().from(tickets).where(eq(tickets.id, id))
  return found
}

async function messagesOn(ticketId: TicketId) {
  return testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.ticketId, ticketId))
}

describe('ticket writes check visibility (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('status: NotFound on a hidden ticket, which stays unchanged; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(setTicketStatus(hidden, w.pending, w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden)).statusId).toBe(w.open)
    await setTicketStatus(visible, w.pending, w.actor)
    expect((await row(visible)).statusId).toBe(w.pending)
  })

  it('assign: NotFound on a hidden ticket, which stays unchanged; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(
      assignTicket(hidden, { assigneePrincipalId: w.teammate }, w.actor)
    ).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden)).assigneePrincipalId).toBeNull()
    await assignTicket(visible, { assigneePrincipalId: w.teammate }, w.actor)
    expect((await row(visible)).assigneePrincipalId).toBe(w.teammate)
  })

  it('assign: a hidden ticket cannot be pulled into scope by assigning it to my team', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    await expect(assignTicket(hidden, { assigneeTeamId: w.teamX }, w.actor)).rejects.toMatchObject(
      NOT_FOUND
    )
    expect((await row(hidden)).assigneeTeamId).toBe(w.teamY)
  })

  it('priority: NotFound on a hidden ticket, which stays unchanged; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(setTicketPriority(hidden, 'urgent', w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden)).priority).toBe('none')
    await setTicketPriority(visible, 'urgent', w.actor)
    expect((await row(visible)).priority).toBe('urgent')
  })

  it('soft delete: NotFound on a hidden ticket, which stays; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(softDeleteTicket(hidden, w.actor)).rejects.toMatchObject(NOT_FOUND)
    expect((await row(hidden)).deletedAt).toBeNull()
    await softDeleteTicket(visible, w.actor)
    expect((await row(visible)).deletedAt).not.toBeNull()
  })

  it('bulk: a hidden id fails with the same reason as a missing id and stays unchanged', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    const missing = createId('ticket') as TicketId
    const result = await bulkUpdateTickets(
      [visible, hidden, missing],
      { type: 'priority', priority: 'high' },
      w.actor
    )
    expect(result.succeeded).toEqual([visible])
    const reasons = new Map(result.failed.map((f) => [f.id, f.reason]))
    expect([...reasons.keys()].sort()).toEqual([hidden, missing].sort())
    expect(reasons.get(hidden)).toBe(reasons.get(missing))
    expect((await row(hidden)).priority).toBe('none')
    expect((await row(visible)).priority).toBe('high')
  })

  it('bulk: without the action permission a hidden id still fails exactly as a missing id', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const missing = createId('ticket') as TicketId
    const noStatusKey: Actor = {
      ...w.actor,
      permissions: new Set([PERMISSIONS.TICKET_VIEW]),
    }
    const result = await bulkUpdateTickets(
      [hidden, missing],
      { type: 'priority', priority: 'high' },
      noStatusKey
    )
    expect(result.succeeded).toEqual([])
    const reasons = new Map(result.failed.map((f) => [f.id, f.reason]))
    expect(reasons.get(hidden)).toBe(reasons.get(missing))
  })

  it('reply: NotFound on a hidden ticket and no message is written; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(
      sendTicketMessage(w.actor, { ticketId: hidden, content: 'Hello from Acme' })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(await messagesOn(hidden)).toHaveLength(0)
    await sendTicketMessage(w.actor, { ticketId: visible, content: 'Hello from Acme' })
    expect(await messagesOn(visible)).toHaveLength(1)
  })

  it('note: NotFound on a hidden ticket and no note is written; works on a visible one', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(
      addTicketNote(w.actor, { ticketId: hidden, content: 'Acme note' })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(await messagesOn(hidden)).toHaveLength(0)
    await addTicketNote(w.actor, { ticketId: visible, content: 'Acme note' })
    expect(await messagesOn(visible)).toHaveLength(1)
  })

  describe('a tracker with one visible and two hidden linked tickets', () => {
    async function seedTracker() {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const visible = await w.ticket(w.teamX)
      const hiddenStandalone = await w.ticket(w.teamY)
      const hiddenPaired = await w.ticket(w.teamY)
      const visitor = await seedPerson('user')
      const conversationId = createId('conversation') as ConversationId
      await testDb
        .insert(conversations)
        .values({ id: conversationId, visitorPrincipalId: visitor, channel: 'messenger' })
      await testDb
        .insert(ticketConversations)
        .values({ ticketId: hiddenPaired, conversationId, ticketType: 'customer' })
      for (const linked of [visible, hiddenStandalone, hiddenPaired]) {
        await testDb
          .insert(ticketLinks)
          .values({ trackerTicketId: tracker, linkedTicketId: linked, relation: 'tracks' })
      }
      return { ...w, tracker, visible, hiddenStandalone, hiddenPaired, conversationId }
    }

    it('a status change reaches all three, each recorded with the teammate as author', async () => {
      const t = await seedTracker()
      await setTicketStatus(t.tracker, t.pending, t.actor)
      const linked = [t.visible, t.hiddenStandalone, t.hiddenPaired]
      for (const id of linked) expect((await row(id)).statusId).toBe(t.pending)
      const moves = await testDb
        .select()
        .from(ticketActivity)
        .where(
          and(inArray(ticketActivity.ticketId, linked), eq(ticketActivity.type, 'status.changed'))
        )
      expect(moves).toHaveLength(3)
      for (const move of moves) expect(move.principalId).toBe(t.teammate)
    })

    it('a reply-all reaches all three, each written with the teammate as author', async () => {
      const t = await seedTracker()
      const content = `Fixed in 1.2.3 ${suffix()}`
      await sendTicketMessage(t.actor, { ticketId: t.tracker, content, replyAll: true })
      const copies = (
        await testDb
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.content, content))
      ).filter((m) => m.metadata?.repliedAllFromTicketId === t.tracker)
      expect(copies).toHaveLength(3)
      expect(copies.map((c) => c.ticketId ?? c.conversationId).sort()).toEqual(
        [t.visible, t.hiddenStandalone, t.conversationId].sort()
      )
      for (const copy of copies) expect(copy.principalId).toBe(t.teammate)
    })

    it('the same teammate still cannot write to a hidden linked ticket directly', async () => {
      const t = await seedTracker()
      await expect(setTicketStatus(t.hiddenStandalone, t.pending, t.actor)).rejects.toMatchObject(
        NOT_FOUND
      )
      await expect(
        sendTicketMessage(t.actor, { ticketId: t.hiddenStandalone, content: 'Acme' })
      ).rejects.toMatchObject(NOT_FOUND)
      expect((await row(t.hiddenStandalone)).statusId).toBe(t.open)
    })

    it('a hidden tracker answers NotFound and cascades nothing', async () => {
      const t = await seedTracker()
      await testDb
        .update(tickets)
        .set({ assigneeTeamId: t.teamY })
        .where(eq(tickets.id, t.tracker))
      await expect(setTicketStatus(t.tracker, t.pending, t.actor)).rejects.toMatchObject(
        NOT_FOUND
      )
      await expect(
        sendTicketMessage(t.actor, { ticketId: t.tracker, content: 'Acme', replyAll: true })
      ).rejects.toMatchObject(NOT_FOUND)
      for (const id of [t.visible, t.hiddenStandalone, t.hiddenPaired])
        expect((await row(id)).statusId).toBe(t.open)
    })
  })

  it('a workspace-wide service actor still writes to any ticket', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const service: Actor = {
      principalId: null,
      role: 'admin',
      principalType: 'service',
      segmentIds: new Set(),
      permissions: new Set(SCOPED_PERMISSIONS),
    }
    await setTicketStatus(hidden, w.pending, service)
    expect((await row(hidden)).statusId).toBe(w.pending)
  })
})
