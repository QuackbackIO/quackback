/**
 * Real-DB coverage for sharing a customer ticket with other customers
 * (ticket-sharing.service + the participant read/write paths): who can share
 * with whom, what a participant can then see and do on the shared thread, and
 * what stays the requester's. Real conversation write pipeline; only realtime,
 * the event bridges and the offline-email dispatch are spied.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type CompanyId,
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
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
const ticketEmit = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketRepliedAs: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketSubscriberAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketSubscriberRemoved: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => ticketEmit)
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
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  companies,
  conversationMessages,
  conversationParticipants,
  conversations,
  principal,
  settings,
  ticketConversations,
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  user,
  and,
  eq,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import {
  addTicketParticipantByEmail,
  claimSharedTicketsForVerifiedEmail,
  removeTicketParticipant,
} from '../ticket-sharing.service'
import {
  getCustomerTicketForConversation,
  getTicketSharing,
  listShareableColleagues,
  removeTicketShare,
  shareTicketWithColleague,
} from '../customer-ticket-sharing.service'
import { listMyTicketSummaries } from '../requester.service'
import {
  getConversationForCustomer,
  listConversationsForCustomer,
  countVisitorUnreadMessages,
} from '../../conversation/conversation.query'
import {
  assertConversationViewable,
  markConversationRead,
  recordCsat,
  sendVisitorMessage,
} from '../../conversation/conversation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ access: conversationParticipants.threadAccess })
      .from(conversationParticipants)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedCompany(): Promise<CompanyId> {
  const id = createId('company') as CompanyId
  await testDb.insert(companies).values({ id, name: `Acme ${suffix()}` })
  return id
}

async function seedCustomer(
  name: string,
  opts: { companyId?: CompanyId | null; email?: string } = {}
): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name, email: opts.email ?? `${suffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    companyId: opts.companyId ?? null,
    createdAt: new Date(),
  })
  return principalId
}

async function seedAgent(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Agent', email: `${suffix()}@team.test` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/** A customer ticket paired with a messenger conversation, requested by `requester`. */
async function seedPairedTicket(requester: PrincipalId, companyId: CompanyId | null = null) {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'S-Open', slug: `s_open_${suffix()}`, category: 'open', position: 400 })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      title: `Shared ${suffix()}`,
      statusId: status.id as TicketStatusId,
      type: 'customer',
      requesterPrincipalId: requester,
      companyId,
    })
    .returning()
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: requester, channel: 'messenger' })
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticket.id, conversationId, ticketType: 'customer' })
  return { ticketId: ticket.id as TicketId, conversationId }
}

function agentActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>([
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_REPLY,
    ]),
  }
}

function customerActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(),
  }
}

async function participantRow(conversationId: ConversationId, principalId: PrincipalId) {
  const [row] = await testDb
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.principalId, principalId)
      )
    )
  return row ?? null
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

describe.skipIf(!fixture.available)('sharing a customer ticket (real DB, rolled back)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await fixture.begin()
    // The ticket DTO reads the workspace's stage labels.
    if (!(await testDb.query.settings.findFirst())) {
      await testDb.insert(settings).values({ name: 'Acme', slug: 'acme', createdAt: new Date() })
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the team shares by email', () => {
    it('gives the person the thread and a watch, and announces it once', async () => {
      const requester = await seedCustomer('Rita')
      const colleague = await seedCustomer('Cole', { email: 'cole@example.com' })
      const agent = await seedAgent()
      const { ticketId, conversationId } = await seedPairedTicket(requester)

      const result = await addTicketParticipantByEmail(
        ticketId,
        'Cole@Example.com',
        agentActor(agent)
      )
      expect(result).toEqual({ principalId: colleague, added: true })
      expect((await participantRow(conversationId, colleague))?.threadAccess).toBe(true)
      expect(await watchReason(ticketId, colleague)).toBe('participant')
      expect(ticketEmit.emitTicketSubscriberAdded).toHaveBeenCalledTimes(1)
      expect(ticketEmit.emitTicketSubscriberAdded.mock.calls[0][3]).toBe('participant')

      vi.clearAllMocks()
      const again = await addTicketParticipantByEmail(
        ticketId,
        'cole@example.com',
        agentActor(agent)
      )
      expect(again.added).toBe(false)
      expect(ticketEmit.emitTicketSubscriberAdded).not.toHaveBeenCalled()
    })

    it('refuses a ticket with no customer thread', async () => {
      const agent = await seedAgent()
      const [status] = await testDb
        .insert(ticketStatuses)
        .values({ name: 'S-BO', slug: `s_bo_${suffix()}`, category: 'open', position: 401 })
        .returning()
      const [backOffice] = await testDb
        .insert(tickets)
        .values({ title: 'Internal', statusId: status.id, type: 'back_office' })
        .returning()
      await expect(
        addTicketParticipantByEmail(backOffice.id as TicketId, 'x@example.com', agentActor(agent))
      ).rejects.toMatchObject({ code: 'TICKET_NOT_SHAREABLE' })
    })

    it('takes the thread and the watch away again', async () => {
      const requester = await seedCustomer('Rita')
      const colleague = await seedCustomer('Cole', { email: 'cole2@example.com' })
      const agent = await seedAgent()
      const { ticketId, conversationId } = await seedPairedTicket(requester)
      await addTicketParticipantByEmail(ticketId, 'cole2@example.com', agentActor(agent))

      expect(await removeTicketParticipant(ticketId, colleague, agentActor(agent))).toEqual({
        removed: true,
      })
      expect(await participantRow(conversationId, colleague)).toBeNull()
      expect(await watchReason(ticketId, colleague)).toBeNull()
      expect((await getConversationForCustomer(conversationId, colleague)).conversation).toBeNull()
    })
  })

  describe('what a participant gets', () => {
    async function sharedWorld() {
      const companyId = await seedCompany()
      const requester = await seedCustomer('Rita', { companyId })
      const colleague = await seedCustomer('Cole', {
        companyId,
        email: `cole_${suffix()}@example.com`,
      })
      const agent = await seedAgent()
      const pair = await seedPairedTicket(requester, companyId)
      await testDb.insert(conversationParticipants).values({
        conversationId: pair.conversationId,
        principalId: colleague,
        addedByPrincipalId: agent,
        threadAccess: true,
      })
      return { ...pair, requester, colleague, agent, companyId }
    }

    it('opens and lists the shared thread, a plain group-thread participant does not', async () => {
      const { conversationId, colleague, requester } = await sharedWorld()
      const opened = await getConversationForCustomer(conversationId, colleague)
      expect(opened.role).toBe('participant')
      const { conversations: listed, sharedIds } = await listConversationsForCustomer(colleague)
      expect(listed.map((c) => c.id)).toContain(conversationId)
      expect(sharedIds).toEqual([conversationId])
      await expect(
        assertConversationViewable(conversationId, customerActor(colleague))
      ).resolves.toMatchObject({ id: conversationId })

      // An email-only participant (no thread access) sees nothing.
      const emailOnly = await seedCustomer('Eve')
      await testDb.insert(conversationParticipants).values({
        conversationId,
        principalId: emailOnly,
        addedByPrincipalId: requester,
      })
      expect((await getConversationForCustomer(conversationId, emailOnly)).conversation).toBeNull()
      await expect(
        assertConversationViewable(conversationId, customerActor(emailOnly))
      ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
    })

    it("sees the ticket without the requester's company, assignee or form answers", async () => {
      const { conversationId, colleague, requester, ticketId } = await sharedWorld()
      await testDb
        .update(tickets)
        .set({ customAttributes: { plan: 'enterprise' } })
        .where(eq(tickets.id, ticketId))
      const own = await getCustomerTicketForConversation(conversationId, requester)
      expect(own?.relation).toBe('requester')
      expect(own?.ticket.company).not.toBeNull()
      const shared = await getCustomerTicketForConversation(conversationId, colleague)
      expect(shared?.relation).toBe('participant')
      expect(shared?.ticket.company).toBeNull()
      expect(shared?.ticket.customAttributes).toEqual({})
      expect(shared?.ticket.assignee.principalId).toBeNull()

      const mine = await listMyTicketSummaries(colleague)
      expect(mine.map((t) => [t.ticketId, t.relation])).toEqual([[ticketId, 'participant']])
    })

    it("replies as themselves, without moving the requester's read state or channel", async () => {
      const { conversationId, colleague } = await sharedWorld()
      const before = (
        await testDb.select().from(conversations).where(eq(conversations.id, conversationId))
      )[0]
      const { message } = await sendVisitorMessage(
        { conversationId, content: 'Same problem here' },
        { principalId: colleague, displayName: 'Cole' },
        customerActor(colleague)
      )
      expect(message.author?.principalId).toBe(colleague)
      const after = (
        await testDb.select().from(conversations).where(eq(conversations.id, conversationId))
      )[0]
      expect(after.visitorLastReadAt?.getTime() ?? null).toBe(
        before.visitorLastReadAt?.getTime() ?? null
      )
      expect(after.channel).toBe(before.channel)
      expect((await participantRow(conversationId, colleague))?.lastReadAt).not.toBeNull()
    })

    it("reads on their own watermark and can't rate the conversation", async () => {
      const { conversationId, colleague, agent } = await sharedWorld()
      await testDb.insert(conversationMessages).values({
        conversationId,
        principalId: agent,
        senderType: 'agent',
        content: 'We are on it',
      })
      expect(await countVisitorUnreadMessages(colleague)).toBe(1)
      await markConversationRead(conversationId, customerActor(colleague))
      expect(await countVisitorUnreadMessages(colleague)).toBe(0)
      const [conv] = await testDb
        .select({ visitorLastReadAt: conversations.visitorLastReadAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      expect(conv.visitorLastReadAt).toBeNull()
      await expect(
        recordCsat(conversationId, 5, undefined, customerActor(colleague))
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('loses everything when the ticket is deleted', async () => {
      const { conversationId, colleague, ticketId } = await sharedWorld()
      await testDb.update(tickets).set({ deletedAt: new Date() }).where(eq(tickets.id, ticketId))
      expect((await getConversationForCustomer(conversationId, colleague)).conversation).toBeNull()
      expect((await listConversationsForCustomer(colleague)).sharedIds).toEqual([])
    })
  })

  describe('the requester shares with colleagues', () => {
    it('shares with a colleague from their company, picked or typed, and never anyone else', async () => {
      const companyId = await seedCompany()
      const requester = await seedCustomer('Rita', { companyId })
      const colleague = await seedCustomer('Cole', { companyId, email: 'cole3@example.com' })
      const typed = await seedCustomer('Tess', { companyId, email: 'tess@example.com' })
      const outsider = await seedCustomer('Oz', { email: 'oz@example.com' })
      const { ticketId, conversationId } = await seedPairedTicket(requester, companyId)
      const me = customerActor(requester)

      const offered = await listShareableColleagues(me, ticketId)
      expect(offered.map((c) => c.principalId).sort()).toEqual([colleague, typed].sort())
      expect(offered[0]).not.toHaveProperty('email')

      expect(await shareTicketWithColleague(me, ticketId, { principalId: colleague })).toEqual({
        principalId: colleague,
        added: true,
      })
      expect(
        (await shareTicketWithColleague(me, ticketId, { email: 'TESS@example.com' })).added
      ).toBe(true)
      expect((await participantRow(conversationId, typed))?.threadAccess).toBe(true)

      // An outsider, by id or by address, is the same "not found".
      await expect(
        shareTicketWithColleague(me, ticketId, { principalId: outsider })
      ).rejects.toMatchObject({ code: 'COLLEAGUE_NOT_FOUND' })
      await expect(
        shareTicketWithColleague(me, ticketId, { email: 'oz@example.com' })
      ).rejects.toMatchObject({ code: 'COLLEAGUE_NOT_FOUND' })
      await expect(
        shareTicketWithColleague(me, ticketId, { email: 'nobody@example.com' })
      ).rejects.toMatchObject({ code: 'COLLEAGUE_NOT_FOUND' })
    })

    it('cannot share without a company, nor share on as a participant', async () => {
      const requester = await seedCustomer('Rita')
      const { ticketId } = await seedPairedTicket(requester)
      const sharing = await getTicketSharing(customerActor(requester), ticketId)
      expect(sharing.canShare).toBe(false)
      expect(await listShareableColleagues(customerActor(requester), ticketId)).toEqual([])

      const companyId = await seedCompany()
      const owner = await seedCustomer('Owen', { companyId })
      const member = await seedCustomer('Mia', { companyId })
      const other = await seedCustomer('Ola', { companyId })
      const shared = await seedPairedTicket(owner, companyId)
      await shareTicketWithColleague(customerActor(owner), shared.ticketId, { principalId: member })
      await expect(
        shareTicketWithColleague(customerActor(member), shared.ticketId, { principalId: other })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('removes only the people they added; anyone can leave', async () => {
      const companyId = await seedCompany()
      const requester = await seedCustomer('Rita', { companyId })
      const colleague = await seedCustomer('Cole', { companyId })
      const teamAdded = await seedCustomer('Tim', { companyId, email: 'tim@example.com' })
      const agent = await seedAgent()
      const { ticketId } = await seedPairedTicket(requester, companyId)
      await shareTicketWithColleague(customerActor(requester), ticketId, { principalId: colleague })
      await addTicketParticipantByEmail(ticketId, 'tim@example.com', agentActor(agent))

      const sharing = await getTicketSharing(customerActor(requester), ticketId)
      const byId = new Map(sharing.people.map((p) => [p.principalId, p]))
      expect(byId.get(colleague)?.canRemove).toBe(true)
      expect(byId.get(teamAdded)?.canRemove).toBe(false)
      expect(byId.get(requester)?.isRequester).toBe(true)

      await expect(
        removeTicketShare(customerActor(requester), ticketId, teamAdded)
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await removeTicketShare(customerActor(teamAdded), ticketId, teamAdded)).toEqual({
        removed: true,
      })
      expect(await removeTicketShare(customerActor(requester), ticketId, colleague)).toEqual({
        removed: true,
      })
    })
  })

  it('hands the tickets shared with an address to the account that verifies it', async () => {
    const requester = await seedCustomer('Rita')
    const agent = await seedAgent()
    const { ticketId, conversationId } = await seedPairedTicket(requester)
    const { principalId: lead } = await addTicketParticipantByEmail(
      ticketId,
      'newbie@example.com',
      agentActor(agent)
    )
    const account = await seedCustomer('Newbie', { email: 'newbie@example.com' })

    expect(await claimSharedTicketsForVerifiedEmail(account, 'newbie@example.com')).toEqual({
      claimed: 1,
    })
    expect((await participantRow(conversationId, account))?.threadAccess).toBe(true)
    expect(await participantRow(conversationId, lead)).toBeNull()
    expect(await watchReason(ticketId, account)).toBe('participant')
    expect(await watchReason(ticketId, lead)).toBeNull()
  })
})
