/**
 * Real-DB coverage for what a requester receives about their own ticket:
 *
 * - the requester DTO is an explicit allow-list (exact key set), with no
 *   agent-only key and only the ticket type's customer-visible field answers;
 * - its `updatedAt` is the last change the customer can see (their thread's
 *   newest public message, else the newest move into a status with a customer
 *   stage, else `createdAt`), so an internal note, an assignment or a priority
 *   change never moves it, and the customer ticket list sorts on the same time.
 *
 * Runs inside the db-test-fixture rollback transaction. Postgres `now()` is
 * frozen inside one transaction, so every seeded time is explicit and earlier
 * than the transaction's own writes: a write that wrongly counts shows up as a
 * jump to the transaction time.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type UserId,
  type TicketId,
  type TicketStatusId,
  type TicketTypeId,
  type TeamId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

const realtime = vi.hoisted(() => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// The ticket and conversation webhook bridges resolve hook targets outside
// the rollback transaction; their behaviour is not under test here.
vi.mock('../ticket.webhooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ticket.webhooks')>()
  const stubbed: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(actual)) {
    stubbed[name] = typeof value === 'function' ? vi.fn().mockResolvedValue(undefined) : value
  }
  return stubbed
})
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/conversation/conversation.webhooks')>()
  const stubbed: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(actual)) {
    stubbed[name] = typeof value === 'function' ? vi.fn().mockResolvedValue(undefined) : value
  }
  return stubbed
})

// The fire-and-forget activity insert (priority changes) is not awaited, so it
// could land after the fixture rolls back. Status moves write their activity
// row inside setTicketStatus's own transaction and are unaffected.
vi.mock('../ticket-activity.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticket-activity.service')>()),
  recordTicketActivity: vi.fn(),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  tickets,
  ticketActivity,
  ticketConversations,
  ticketStatuses,
  ticketTypes,
  teams,
  principal,
  user,
  settings,
  eq,
  and,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { setTicketStatus, setTicketPriority, assignTicket } from '../ticket.service'
import { addTicketNote } from '../ticket-message.service'
import { assignConversation } from '@/lib/server/domains/conversation/conversation.service'
import {
  createMyTicket,
  getRequesterTicketForConversation,
  listMyTicketSummaries,
} from '../requester.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Well-separated past times, all earlier than the transaction's `now()`. */
const T0 = new Date('2026-01-01T00:00:00.000Z')
const T1 = new Date('2026-01-02T00:00:00.000Z')
const T2 = new Date('2026-01-03T00:00:00.000Z')
const T3 = new Date('2026-01-04T00:00:00.000Z')

/** The keys a requester may receive. Written out here, not imported, so a new
 *  key added to the DTO fails this suite until it is deliberately allowed. */
const REQUESTER_KEYS = [
  'assignee',
  'company',
  'createdAt',
  'customAttributes',
  'id',
  'lastMessagePreview',
  'number',
  'reference',
  'requester',
  'resolvedAt',
  'stage',
  'ticketType',
  'title',
  'type',
  'updatedAt',
]

async function seedPrincipal(role: 'member' | 'admin' = 'member'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function seedAgent(): Promise<Actor> {
  const principalId = await seedPrincipal('admin')
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

async function seedStatus(input: {
  category: 'open' | 'pending' | 'closed'
  publicStage: 'received' | 'in_progress' | 'awaiting_requester' | 'resolved' | null
}): Promise<TicketStatusId> {
  const [row] = await testDb
    .insert(ticketStatuses)
    .values({
      name: `S-${suffix()}`,
      slug: `s_${suffix()}`,
      category: input.category,
      publicStage: input.publicStage,
    })
    .returning({ id: ticketStatuses.id })
  return row.id
}

async function seedTicketType(): Promise<TicketTypeId> {
  const [row] = await testDb
    .insert(ticketTypes)
    .values({
      name: `Bug-${suffix()}`,
      slug: `bug_${suffix()}`,
      category: 'customer',
      fields: [
        {
          key: 'order_number',
          label: 'Order number',
          type: 'text',
          required: false,
          visibleToCustomer: true,
          order: 0,
        },
        {
          key: 'root_cause',
          label: 'Root cause',
          type: 'text',
          required: false,
          visibleToCustomer: false,
          order: 1,
        },
      ],
    })
    .returning({ id: ticketTypes.id })
  return row.id
}

async function seedPair(input: {
  requester: PrincipalId
  statusId: TicketStatusId
  createdAt?: Date
  updatedAt?: Date
}): Promise<{ conversationId: ConversationId; ticketId: TicketId }> {
  const conversationId = createId('conversation') as ConversationId
  const ticketId = createId('ticket') as TicketId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId: input.requester, channel: 'messenger' })
  await testDb.insert(tickets).values({
    id: ticketId,
    title: 'Pair ticket',
    statusId: input.statusId,
    type: 'customer',
    requesterPrincipalId: input.requester,
    createdAt: input.createdAt ?? T0,
    updatedAt: input.updatedAt ?? input.createdAt ?? T0,
  })
  await testDb
    .insert(ticketConversations)
    .values({ ticketId, conversationId, ticketType: 'customer' })
  return { conversationId, ticketId }
}

/** A public visitor message on the pair's conversation at a fixed time. */
async function postVisitorMessage(
  conversationId: ConversationId,
  requester: PrincipalId,
  at: Date
): Promise<void> {
  await testDb.insert(conversationMessages).values({
    conversationId,
    principalId: requester,
    senderType: 'visitor',
    content: 'A public message',
    isInternal: false,
    createdAt: at,
  })
}

async function seedWorld(): Promise<PrincipalId> {
  await testDb
    .insert(settings)
    .values({ name: 'WS', slug: `ws_${suffix()}`, createdAt: new Date() })
  return seedPrincipal()
}

describe.skipIf(!fixture.available)('requester ticket DTO and customer-visible time', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sends only the allow-listed keys and the customer-visible field answers', async () => {
    const me = await seedWorld()
    const agent = await seedAgent()
    const statusId = await seedStatus({ category: 'open', publicStage: 'in_progress' })
    const typeId = await seedTicketType()
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Tier 2-${suffix()}` })
      .returning({ id: teams.id })
    const pair = await seedPair({ requester: me, statusId })
    await testDb
      .update(tickets)
      .set({
        ticketTypeId: typeId,
        priority: 'high',
        assigneePrincipalId: agent.principalId,
        assigneeTeamId: team.id as TeamId,
        dueAt: T3,
        firstResponseAt: T1,
        reopenedCount: 2,
        customAttributes: {
          order_number: 'A-1001',
          root_cause: 'Cache stampede',
          triage_reason: { v: 'Billing', src: 'teammate', at: T1.toISOString() },
        },
      })
      .where(eq(tickets.id, pair.ticketId))

    const dto = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(dto).not.toBeNull()
    expect(Object.keys(dto!).sort()).toEqual(REQUESTER_KEYS)
    expect(Object.keys(dto!.assignee).sort()).toEqual(['displayName', 'principalId'])
    expect(dto!.assignee.principalId).toBe(agent.principalId)
    expect(dto!.customAttributes).toEqual({ order_number: 'A-1001' })

    // An attribute envelope stored under a visible field's key is an
    // attribute write, not the customer's answer: it is left out.
    await testDb
      .update(tickets)
      .set({
        customAttributes: {
          order_number: { v: 'Set by a teammate', src: 'teammate', at: T1.toISOString() },
        },
      })
      .where(eq(tickets.id, pair.ticketId))
    const afterEnvelope = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(afterEnvelope!.customAttributes).toEqual({})
  })

  it('createMyTicket returns the same allow-listed shape', async () => {
    const me = await seedWorld()
    await seedStatus({ category: 'open', publicStage: 'received' })
    const created = await createMyTicket(requesterActor(me), { title: 'Cannot export' })
    expect(Object.keys(created).sort()).toEqual(REQUESTER_KEYS)
    expect(Object.keys(created.assignee).sort()).toEqual(['displayName', 'principalId'])
    expect(created.customAttributes).toEqual({})
  })

  it('a ticket with no public message and no staged status move shows its createdAt', async () => {
    const me = await seedWorld()
    const statusId = await seedStatus({ category: 'open', publicStage: 'received' })
    const pair = await seedPair({ requester: me, statusId, createdAt: T0, updatedAt: T2 })

    const dto = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(dto!.updatedAt).toBe(T0.toISOString())
  })

  it('an internal note, a conversation assignment and a priority change leave the time and the list order alone; a public reply moves both', async () => {
    const me = await seedWorld()
    const agent = await seedAgent()
    const statusId = await seedStatus({ category: 'open', publicStage: 'in_progress' })
    const older = await seedPair({ requester: me, statusId, updatedAt: T1 })
    const newer = await seedPair({ requester: me, statusId, updatedAt: T2 })
    await postVisitorMessage(older.conversationId, me, T1)
    await postVisitorMessage(newer.conversationId, me, T2)

    expect((await listMyTicketSummaries(me)).map((t) => t.ticketId)).toEqual([
      newer.ticketId,
      older.ticketId,
    ])

    // Teammate-only activity on the OLDER ticket.
    await addTicketNote(agent, { ticketId: older.ticketId, content: 'Checking the logs' })
    await assignConversation(older.conversationId, agent.principalId!, agent)
    await assignTicket(older.ticketId, { assigneePrincipalId: agent.principalId }, agent)
    await setTicketPriority(older.ticketId, 'urgent', agent)

    // The assignment wrote a non-internal system line on the conversation,
    // so the system-row exclusion is what keeps the time still.
    const systemRows = await testDb
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, older.conversationId),
          eq(conversationMessages.senderType, 'system'),
          eq(conversationMessages.isInternal, false)
        )
      )
    expect(systemRows.length).toBeGreaterThan(0)

    const afterNote = await getRequesterTicketForConversation(older.conversationId, me)
    expect(afterNote!.updatedAt).toBe(T1.toISOString())
    const listAfterNote = await listMyTicketSummaries(me)
    expect(listAfterNote.map((t) => t.ticketId)).toEqual([newer.ticketId, older.ticketId])
    expect(listAfterNote.find((t) => t.ticketId === older.ticketId)!.updatedAt).toBe(
      T1.toISOString()
    )

    // A public reply on the older ticket moves it to the top.
    await postVisitorMessage(older.conversationId, me, T3)
    const afterReply = await getRequesterTicketForConversation(older.conversationId, me)
    expect(afterReply!.updatedAt).toBe(T3.toISOString())
    expect((await listMyTicketSummaries(me)).map((t) => t.ticketId)).toEqual([
      older.ticketId,
      newer.ticketId,
    ])
  })

  it('with no public message, a move into a staged status counts and a move into an unstaged status does not', async () => {
    const me = await seedWorld()
    const agent = await seedAgent()
    const start = await seedStatus({ category: 'open', publicStage: 'received' })
    const unstaged = await seedStatus({ category: 'open', publicStage: null })
    const staged = await seedStatus({ category: 'pending', publicStage: 'awaiting_requester' })
    const pair = await seedPair({ requester: me, statusId: start, createdAt: T0 })

    await setTicketStatus(pair.ticketId, unstaged, agent)
    const afterUnstaged = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(afterUnstaged!.updatedAt).toBe(T0.toISOString())

    await setTicketStatus(pair.ticketId, staged, agent)
    const [move] = await testDb
      .select({ createdAt: ticketActivity.createdAt })
      .from(ticketActivity)
      .where(
        and(eq(ticketActivity.ticketId, pair.ticketId), eq(ticketActivity.type, 'status.changed'))
      )
      .orderBy(ticketActivity.createdAt)
    const afterStaged = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(afterStaged!.updatedAt).toBe(move.createdAt.toISOString())
    expect(afterStaged!.updatedAt).not.toBe(T0.toISOString())
  })

  it('a reopen into a staged status counts as a status move', async () => {
    const me = await seedWorld()
    const closed = await seedStatus({ category: 'closed', publicStage: 'resolved' })
    const reopened = await seedStatus({ category: 'open', publicStage: 'received' })
    const pair = await seedPair({ requester: me, statusId: closed, createdAt: T0 })
    // The reopen record shape written by autoReopenOnRequesterReply. Seeded
    // directly because the real reopen needs a public requester message,
    // which would win on its own and hide this arm.
    await testDb.insert(ticketActivity).values({
      ticketId: pair.ticketId,
      principalId: me,
      type: 'ticket.reopened',
      metadata: { fromId: closed, toId: reopened, trigger: 'requester_reply' },
      createdAt: T2,
    })

    const dto = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(dto!.updatedAt).toBe(T2.toISOString())
  })

  it('counts a public message on a standalone ticket with no pair', async () => {
    const me = await seedWorld()
    const statusId = await seedStatus({ category: 'open', publicStage: 'received' })
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'Standalone',
      statusId,
      type: 'customer',
      requesterPrincipalId: me,
      createdAt: T0,
      updatedAt: T0,
    })
    await testDb.insert(conversationMessages).values({
      ticketId,
      principalId: me,
      senderType: 'visitor',
      content: 'A public message',
      isInternal: false,
      createdAt: T2,
    })
    await testDb.insert(conversationMessages).values({
      ticketId,
      principalId: me,
      senderType: 'agent',
      content: 'An internal note',
      isInternal: true,
      createdAt: T3,
    })

    const [summary] = (await listMyTicketSummaries(me)).filter((t) => t.ticketId === ticketId)
    expect(summary.conversationId).toBeNull()
    expect(summary.updatedAt).toBe(T2.toISOString())
  })

  it('a public message wins over a later status move', async () => {
    const me = await seedWorld()
    const start = await seedStatus({ category: 'open', publicStage: 'received' })
    const done = await seedStatus({ category: 'closed', publicStage: 'resolved' })
    const pair = await seedPair({ requester: me, statusId: start, createdAt: T0 })
    await postVisitorMessage(pair.conversationId, me, T1)
    await testDb.insert(ticketActivity).values({
      ticketId: pair.ticketId,
      principalId: me,
      type: 'status.changed',
      metadata: { fromId: start, toId: done },
      createdAt: T2,
    })

    const dto = await getRequesterTicketForConversation(pair.conversationId, me)
    expect(dto!.updatedAt).toBe(T1.toISOString())
  })
})
