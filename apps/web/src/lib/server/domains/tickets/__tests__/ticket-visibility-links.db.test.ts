/**
 * Real-DB coverage for ticket visibility on the link writes: tracker links,
 * the ticket-to-conversation link and the external issue links. A teammate
 * whose role grants team-scoped `ticket.view` gets NotFound for a ticket
 * outside their teams, exactly like a missing one, and nothing is written.
 *
 * The one exception is the link step of the teammate's own create: a ticket
 * created from a conversation takes the conversation's assignee and no team,
 * so its creator may not see it, yet can still link the two. A link of any
 * other ticket checks both items.
 *
 * Real here: the link services, the create, `ticketFilter`,
 * `conversationFilter` and the rows they read and write. Stood in for:
 * realtime fan-out and the webhook and notification bridges.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type TicketExternalLinkId,
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
  conversations,
  eq,
  principal,
  settings,
  teamMembers,
  teams,
  ticketConversations,
  ticketExternalLinks,
  ticketLinks,
  tickets,
  ticketStatuses,
  user,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { createTicket } from '../ticket.service'
import { linkTicketToTracker, unlinkTicketFromTracker } from '../ticket-links.service'
import { linkTicketToConversation } from '../ticket-conversation-link.service'
import {
  createIssueForTicket,
  linkTicketToIssue,
  unlinkTicketIssue,
} from '../ticket-external-links.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketLinks.trackerTicketId }).from(ticketLinks).limit(0)
    await db.select({ id: ticketExternalLinks.id }).from(ticketExternalLinks).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const TICKET_NOT_FOUND = { code: 'TICKET_NOT_FOUND', statusCode: 404 }
const CONVERSATION_NOT_FOUND = { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 }

const SCOPED_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_CREATE,
  PERMISSIONS.TICKET_ASSIGN,
  PERMISSIONS.CONVERSATION_VIEW,
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

async function seedWorld() {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
  const teammate = await seedPerson('member')
  const colleague = await seedPerson('member')
  const visitor = await seedPerson('user')
  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values([
    { teamId: teamX, principalId: teammate },
    { teamId: teamX, principalId: colleague },
  ])
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id: statusId, name: 'Acme open', slug: `vl-${suffix()}`, isDefault: true })

  async function ticket(team: TeamId, type: 'customer' | 'tracker' | 'back_office' = 'customer') {
    const id = createId('ticket') as TicketId
    await testDb
      .insert(tickets)
      .values({ id, title: `T-${suffix()}`, statusId, type, assigneeTeamId: team })
    return id
  }

  async function conversation(assignment: {
    assignedTeamId?: TeamId
    assignedAgentPrincipalId?: PrincipalId
  }) {
    const id = createId('conversation') as ConversationId
    await testDb
      .insert(conversations)
      .values({ id, visitorPrincipalId: visitor, channel: 'messenger', ...assignment })
    return id
  }

  const actor: Actor = {
    principalId: teammate,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(SCOPED_PERMISSIONS),
  }
  return { teammate, colleague, visitor, teamX, teamY, ticket, conversation, actor }
}

async function trackerLinks(trackerId: TicketId) {
  return testDb.select().from(ticketLinks).where(eq(ticketLinks.trackerTicketId, trackerId))
}

async function conversationLinks(ticketId: TicketId) {
  return testDb
    .select()
    .from(ticketConversations)
    .where(eq(ticketConversations.ticketId, ticketId))
}

describe('ticket link writes check visibility (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('tracker links', () => {
    it('link: NotFound when the tracker is hidden, and no link is written', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamY, 'tracker')
      const linked = await w.ticket(w.teamX)
      await expect(linkTicketToTracker(tracker, linked, w.actor)).rejects.toMatchObject(
        TICKET_NOT_FOUND
      )
      expect(await trackerLinks(tracker)).toHaveLength(0)
    })

    it('link: NotFound when the linked ticket is hidden, and no link is written', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const linked = await w.ticket(w.teamY)
      await expect(linkTicketToTracker(tracker, linked, w.actor)).rejects.toMatchObject(
        TICKET_NOT_FOUND
      )
      expect(await trackerLinks(tracker)).toHaveLength(0)
    })

    it('link: works when both are visible', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const linked = await w.ticket(w.teamX)
      await linkTicketToTracker(tracker, linked, w.actor)
      expect(await trackerLinks(tracker)).toHaveLength(1)
    })

    it('unlink: NotFound when either side is hidden, and the link stays', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const hiddenTracker = await w.ticket(w.teamY, 'tracker')
      const hidden = await w.ticket(w.teamY)
      const visible = await w.ticket(w.teamX)
      await testDb.insert(ticketLinks).values([
        { trackerTicketId: tracker, linkedTicketId: hidden, relation: 'tracks' },
        { trackerTicketId: hiddenTracker, linkedTicketId: visible, relation: 'tracks' },
      ])
      await expect(unlinkTicketFromTracker(tracker, hidden, w.actor)).rejects.toMatchObject(
        TICKET_NOT_FOUND
      )
      await expect(
        unlinkTicketFromTracker(hiddenTracker, visible, w.actor)
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
      expect(await trackerLinks(tracker)).toHaveLength(1)
      expect(await trackerLinks(hiddenTracker)).toHaveLength(1)
    })

    it('unlink: works when both are visible', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const visible = await w.ticket(w.teamX)
      await testDb
        .insert(ticketLinks)
        .values({ trackerTicketId: tracker, linkedTicketId: visible, relation: 'tracks' })
      await unlinkTicketFromTracker(tracker, visible, w.actor)
      expect(await trackerLinks(tracker)).toHaveLength(0)
    })
  })

  describe('ticket to conversation link', () => {
    it('the create step: a ticket the teammate cannot see after creating it still links', async () => {
      const w = await seedWorld()
      // A conversation of my team, assigned to a colleague: the new ticket
      // takes the colleague as assignee and no team, so I cannot see it.
      const conversationId = await w.conversation({
        assignedTeamId: w.teamX,
        assignedAgentPrincipalId: w.colleague,
      })
      const created = await createTicket(
        {
          type: 'customer',
          title: 'Acme cannot sign in',
          requesterPrincipalId: w.visitor,
          sourceConversationId: conversationId,
        },
        w.actor
      )
      const [row] = await testDb.select().from(tickets).where(eq(tickets.id, created.id))
      expect(row.assigneePrincipalId).toBe(w.colleague)
      expect(row.assigneeTeamId).toBeNull()

      await linkTicketToConversation(created.id as TicketId, conversationId, w.actor)
      expect(await conversationLinks(created.id as TicketId)).toHaveLength(1)
    })

    it('an existing ticket outside my scope: NotFound and no link', async () => {
      const w = await seedWorld()
      const conversationId = await w.conversation({ assignedTeamId: w.teamX })
      const hidden = await w.ticket(w.teamY)
      await expect(
        linkTicketToConversation(hidden, conversationId, w.actor)
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
      expect(await conversationLinks(hidden)).toHaveLength(0)
    })

    it('a ticket I created that already has a link: NotFound and no second link', async () => {
      const w = await seedWorld()
      const first = await w.conversation({
        assignedTeamId: w.teamX,
        assignedAgentPrincipalId: w.colleague,
      })
      const second = await w.conversation({ assignedTeamId: w.teamX })
      const created = await createTicket(
        { type: 'back_office', title: 'Acme follow-up', sourceConversationId: first },
        w.actor
      )
      await linkTicketToConversation(created.id as TicketId, first, w.actor)
      await expect(
        linkTicketToConversation(created.id as TicketId, second, w.actor)
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
      expect(await conversationLinks(created.id as TicketId)).toHaveLength(1)
    })

    it('a ticket someone else created and never linked: NotFound', async () => {
      const w = await seedWorld()
      const conversationId = await w.conversation({ assignedTeamId: w.teamX })
      const colleagueActor: Actor = { ...w.actor, principalId: w.colleague }
      const otherConversation = await w.conversation({
        assignedTeamId: w.teamX,
        assignedAgentPrincipalId: w.teammate,
      })
      // The colleague's ticket takes my assignment from its source
      // conversation's assignee... so make it land outside my scope.
      const created = await createTicket(
        {
          type: 'back_office',
          title: 'Acme internal',
          assigneePrincipalId: w.colleague,
          sourceConversationId: otherConversation,
        },
        colleagueActor
      )
      await expect(
        linkTicketToConversation(created.id as TicketId, conversationId, w.actor)
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
      expect(await conversationLinks(created.id as TicketId)).toHaveLength(0)
    })

    it('a conversation outside my scope: NotFound and no link', async () => {
      const w = await seedWorld()
      const hiddenConversation = await w.conversation({ assignedTeamId: w.teamY })
      const visible = await w.ticket(w.teamX)
      await expect(
        linkTicketToConversation(visible, hiddenConversation, w.actor)
      ).rejects.toMatchObject(CONVERSATION_NOT_FOUND)
      expect(await conversationLinks(visible)).toHaveLength(0)
    })

    it('a workspace-wide service actor links any pair', async () => {
      const w = await seedWorld()
      const hiddenConversation = await w.conversation({ assignedTeamId: w.teamY })
      const hidden = await w.ticket(w.teamY)
      const service: Actor = {
        principalId: null,
        role: 'admin',
        principalType: 'service',
        segmentIds: new Set(),
        permissions: new Set(SCOPED_PERMISSIONS),
      }
      await linkTicketToConversation(hidden, hiddenConversation, service)
      expect(await conversationLinks(hidden)).toHaveLength(1)
    })
  })

  describe('external issue links', () => {
    it('link, create and unlink on a hidden ticket answer NotFound, not Forbidden', async () => {
      const w = await seedWorld()
      const hidden = await w.ticket(w.teamY)
      await expect(
        linkTicketToIssue(hidden, 'acme/app#1', w.actor, 'github')
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
      await expect(createIssueForTicket(hidden, 'github', w.actor)).rejects.toMatchObject(
        TICKET_NOT_FOUND
      )
      await expect(
        unlinkTicketIssue(hidden, createId('ticket_external_link') as TicketExternalLinkId, w.actor)
      ).rejects.toMatchObject(TICKET_NOT_FOUND)
    })

    it('a visible ticket passes the visibility check and meets the next one', async () => {
      const w = await seedWorld()
      const visible = await w.ticket(w.teamX)
      // No integration is connected, so the link stops at the configuration check.
      await expect(
        linkTicketToIssue(visible, 'acme/app#1', w.actor, 'github')
      ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
      await unlinkTicketIssue(
        visible,
        createId('ticket_external_link') as TicketExternalLinkId,
        w.actor
      )
    })
  })
})
