/**
 * Real-DB coverage for ticket visibility on every agent ticket read, called
 * through the server function handlers. A teammate whose role grants
 * team-scoped `ticket.view` gets NotFound for a ticket outside their teams,
 * exactly like a missing one, on the detail read, the links, the external
 * links, the provenance count, the thread, the transcript export and the
 * ticket attribute write. The paired ticket summary on a conversation (the
 * ticket pill, the panel and the inbox row) is absent for a ticket the caller
 * cannot open, and a ticket embed degrades to unavailable.
 *
 * Real here: the handlers, the services they call, `ticketFilter` and the
 * rows. Stood in for: the session (each test sets the actor), realtime and the
 * webhook bridges.
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
import type { Actor } from '@/lib/server/policy/types'
import type { PermissionKey } from '@/lib/shared/permissions'

const session = vi.hoisted(() => ({ actor: null as unknown as Actor }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.inputValidator = () => chain
    chain.middleware = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))

/** The session stand-in: the caller is `session.actor`, and a permission gate
 *  refuses exactly as the real one does when the actor lacks the key. */
vi.mock('@/lib/server/functions/auth-helpers', async () => {
  const { ForbiddenError } = await import('@/lib/shared/errors')
  const ctxFor = (actor: Actor) => ({
    principal: { id: actor.principalId, role: actor.role, type: 'user' },
    user: { id: 'user_stub' },
    permissions: [...(actor.permissions ?? [])],
  })
  const check = (permission?: PermissionKey) => {
    if (permission && !session.actor.permissions?.has(permission)) {
      throw new ForbiddenError('FORBIDDEN', 'You do not have permission')
    }
  }
  return {
    requireAuth: async (opts?: { permission?: PermissionKey }) => {
      check(opts?.permission)
      return ctxFor(session.actor)
    },
    getOptionalAuth: async () => ctxFor(session.actor),
    policyActorFromAuth: async () => session.actor,
    assertPermission: (_ctx: unknown, permission: PermissionKey) => check(permission),
  }
})

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

vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationAttributeDefinitions,
  conversationMessages,
  conversations,
  eq,
  principal,
  settings,
  teamMembers,
  teams,
  ticketConversations,
  tickets,
  ticketLinks,
  ticketStatuses,
  user,
  PERMISSIONS,
} from '@/lib/server/db'
import {
  exportTicketTranscriptFn,
  fetchTicketExternalLinksFn,
  getTicketFn,
  getTicketLinksFn,
  getTicketProvenanceConversationsFn,
  listTicketMessagesFn,
} from '../tickets'
import { getConversationTicketLinkFn } from '../inbox'
import { setConversationAttributeValueFn } from '../conversation-attributes'
import { loadAgentConversationPanels } from '../conversation-panels'
import { getTicketEmbedForViewer } from '@/lib/server/domains/tickets/ticket-embed.service'
import { listInboxItems } from '@/lib/server/domains/inbox/inbox.query'
import { listMessages } from '@/lib/server/domains/conversation/conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const TICKET_NOT_FOUND = { code: 'TICKET_NOT_FOUND', statusCode: 404 }

const SCOPED_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_SET_STATUS,
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
  const visitor = await seedPerson('user')
  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: teammate })
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb
    .insert(ticketStatuses)
    .values({ id: statusId, name: 'Acme open', slug: `vr-${suffix()}` })

  async function ticket(team: TeamId, type: 'customer' | 'tracker' = 'customer') {
    const id = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id,
      title: `T-${suffix()}`,
      statusId,
      type,
      assigneeTeamId: team,
      requesterPrincipalId: visitor,
    })
    await testDb.insert(conversationMessages).values({
      ticketId: id,
      principalId: visitor,
      senderType: 'visitor',
      content: 'Acme cannot sign in',
    })
    return id
  }

  /** A conversation of my team whose paired customer ticket sits on `team`. */
  async function pair(team: TeamId) {
    const ticketId = await ticket(team)
    const conversationId = createId('conversation') as ConversationId
    await testDb.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedTeamId: teamX,
    })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })
    return { ticketId, conversationId }
  }

  const actor: Actor = {
    principalId: teammate,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(SCOPED_PERMISSIONS),
  }
  session.actor = actor
  return { teammate, visitor, teamX, teamY, ticket, pair, actor }
}

describe('ticket reads check visibility (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  const byTicket: [string, (ticketId: TicketId) => Promise<unknown>][] = [
    ['getTicketFn', (ticketId) => getTicketFn({ data: { ticketId } })],
    ['getTicketLinksFn', (ticketId) => getTicketLinksFn({ data: { ticketId } })],
    ['fetchTicketExternalLinksFn', (ticketId) => fetchTicketExternalLinksFn({ data: { ticketId } })],
    [
      'getTicketProvenanceConversationsFn',
      (ticketId) => getTicketProvenanceConversationsFn({ data: { ticketId } }),
    ],
    ['listTicketMessagesFn', (ticketId) => listTicketMessagesFn({ data: { ticketId } })],
    ['exportTicketTranscriptFn', (ticketId) => exportTicketTranscriptFn({ data: { ticketId } })],
  ]

  it.each(byTicket)('%s: NotFound for a hidden ticket, a result for a visible one', async (_, read) => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    await expect(read(hidden)).rejects.toMatchObject(TICKET_NOT_FOUND)
    await expect(read(visible)).resolves.toBeTruthy()
  })

  it('listTicketMessagesFn returns the thread of a visible ticket', async () => {
    const w = await seedWorld()
    const visible = await w.ticket(w.teamX)
    const page = await listTicketMessagesFn({ data: { ticketId: visible } })
    expect(page.messages.map((m) => m.content)).toEqual(['Acme cannot sign in'])
  })

  it('a ticket attribute write on a hidden ticket is NotFound and changes nothing', async () => {
    const w = await seedWorld()
    const hidden = await w.ticket(w.teamY)
    const visible = await w.ticket(w.teamX)
    const key = `plan_${suffix()}`
    await testDb
      .insert(conversationAttributeDefinitions)
      .values({ key, label: 'Plan', fieldType: 'text' })
    await expect(
      setConversationAttributeValueFn({ data: { ticketId: hidden, key, value: 'Gold' } })
    ).rejects.toMatchObject(TICKET_NOT_FOUND)
    const [row] = await testDb.select().from(tickets).where(eq(tickets.id, hidden))
    expect(row.customAttributes).toEqual({})
    await expect(
      setConversationAttributeValueFn({ data: { ticketId: visible, key, value: 'Gold' } })
    ).resolves.toBeTruthy()
  })

  describe('the paired ticket summary on a conversation', () => {
    it('is absent for a hidden paired ticket on the ticket pill read', async () => {
      const w = await seedWorld()
      const hidden = await w.pair(w.teamY)
      const visible = await w.pair(w.teamX)
      expect(
        await getConversationTicketLinkFn({ data: { conversationId: hidden.conversationId } })
      ).toBeNull()
      expect(
        await getConversationTicketLinkFn({ data: { conversationId: visible.conversationId } })
      ).toMatchObject({ id: visible.ticketId })
    })

    it('is absent for a role without a ticket key, even for a ticket of its own team', async () => {
      const w = await seedWorld()
      const visible = await w.pair(w.teamX)
      session.actor = { ...w.actor, permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]) }
      expect(
        await getConversationTicketLinkFn({ data: { conversationId: visible.conversationId } })
      ).toBeNull()
    })

    it('is absent from the conversation panels for a hidden paired ticket', async () => {
      const w = await seedWorld()
      const hidden = await w.pair(w.teamY)
      const visible = await w.pair(w.teamX)
      const caller = {
        userId: 'user_stub' as never,
        permissions: [...SCOPED_PERMISSIONS],
        actor: w.actor,
      }
      const load = async (conversationId: ConversationId) => {
        const [conversation] = await testDb
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
        return loadAgentConversationPanels(conversation, ['ticketLink', 'linkedTicket'], caller)
      }
      const hiddenPanels = await load(hidden.conversationId)
      expect(hiddenPanels.ticketLink ?? null).toBeNull()
      expect(hiddenPanels.linkedTicket ?? null).toBeNull()
      const visiblePanels = await load(visible.conversationId)
      expect(visiblePanels.ticketLink).toMatchObject({ id: visible.ticketId })
      expect(visiblePanels.linkedTicket).toMatchObject({ id: visible.ticketId })
    })

    it('is absent from the inbox row of a conversation whose paired ticket is hidden', async () => {
      const w = await seedWorld()
      const hidden = await w.pair(w.teamY)
      const visible = await w.pair(w.teamX)
      const page = await listInboxItems(w.actor, { kinds: ['conversation'] } as never)
      const rows = new Map(
        page.items
          .filter((item) => item.kind === 'conversation')
          .map((item) => [item.conversation.id, item.linkedTicket])
      )
      expect(rows.has(hidden.conversationId)).toBe(true)
      expect(rows.get(hidden.conversationId)).toBeNull()
      expect(rows.get(visible.conversationId)).toMatchObject({ id: visible.ticketId })
    })
  })

  describe('the thread of a conversation with a paired ticket', () => {
    async function noteOn(ticketId: TicketId, principalId: PrincipalId) {
      const content = `Acme internal note ${suffix()}`
      await testDb.insert(conversationMessages).values({
        ticketId,
        principalId,
        senderType: 'agent',
        isInternal: true,
        content,
      })
      return content
    }

    it('merges no row of a paired ticket I cannot see, internal notes included', async () => {
      const w = await seedWorld()
      const hidden = await w.pair(w.teamY)
      const note = await noteOn(hidden.ticketId, w.teammate)
      const page = await listMessages(hidden.conversationId, {
        includeInternal: true,
        linkedTicketViewer: w.actor,
      })
      const contents = page.messages.map((m) => m.content)
      expect(contents).not.toContain(note)
      expect(contents).not.toContain('Acme cannot sign in')
    })

    it('still merges the paired ticket I can see', async () => {
      const w = await seedWorld()
      const visible = await w.pair(w.teamX)
      const note = await noteOn(visible.ticketId, w.teammate)
      const page = await listMessages(visible.conversationId, {
        includeInternal: true,
        linkedTicketViewer: w.actor,
      })
      expect(page.messages.map((m) => m.content)).toEqual(
        expect.arrayContaining([note, 'Acme cannot sign in'])
      )
    })
  })

  describe('the links of a visible ticket', () => {
    async function track(tracker: TicketId, linked: TicketId) {
      await testDb
        .insert(ticketLinks)
        .values({ trackerTicketId: tracker, linkedTicketId: linked, relation: 'tracks' })
    }

    it('a tracker lists only the linked tickets I can see, and counts the rest', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const visible = await w.ticket(w.teamX)
      const hiddenA = await w.ticket(w.teamY)
      const hiddenB = await w.ticket(w.teamY)
      for (const id of [visible, hiddenA, hiddenB]) await track(tracker, id)
      const links = await getTicketLinksFn({ data: { ticketId: tracker } })
      expect(links.linked.map((t) => t.id)).toEqual([visible])
      expect(links.hiddenCount).toBe(2)
      const wire = JSON.stringify(links)
      expect(wire).not.toContain(hiddenA)
      expect(wire).not.toContain(hiddenB)
    })

    it('a ticket whose tracker I cannot see shows no tracker, only that one exists', async () => {
      const w = await seedWorld()
      const hiddenTracker = await w.ticket(w.teamY, 'tracker')
      const visible = await w.ticket(w.teamX)
      await track(hiddenTracker, visible)
      const links = await getTicketLinksFn({ data: { ticketId: visible } })
      expect(links.tracker).toBeNull()
      expect(links.trackerHidden).toBe(true)
      expect(JSON.stringify(links)).not.toContain(hiddenTracker)
    })

    it('a visible tracker still shows', async () => {
      const w = await seedWorld()
      const tracker = await w.ticket(w.teamX, 'tracker')
      const visible = await w.ticket(w.teamX)
      await track(tracker, visible)
      const links = await getTicketLinksFn({ data: { ticketId: visible } })
      expect(links.tracker).toMatchObject({ id: tracker })
      expect(links.trackerHidden).toBe(false)
    })
  })

  describe('ticket embeds', () => {
    it('is unavailable to a teammate outside the ticket\'s team, and resolves inside it', async () => {
      const w = await seedWorld()
      const hidden = await w.ticket(w.teamY)
      const visible = await w.ticket(w.teamX)
      expect(await getTicketEmbedForViewer(hidden, w.actor)).toBeNull()
      expect(await getTicketEmbedForViewer(visible, w.actor)).toMatchObject({ id: visible })
    })

    it('still resolves for the ticket\'s own requester', async () => {
      const w = await seedWorld()
      const hidden = await w.ticket(w.teamY)
      const requester: Actor = {
        principalId: w.visitor,
        role: 'user',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set(),
      }
      expect(await getTicketEmbedForViewer(hidden, requester)).toMatchObject({ id: hidden })
    })
  })
})
