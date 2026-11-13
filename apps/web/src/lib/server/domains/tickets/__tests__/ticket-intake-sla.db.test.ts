/**
 * Real-DB coverage for the workspace default SLA on ticket intake. Every
 * intake path creates a customer ticket with a backing conversation, then
 * applies the conversation default SLA and hands the policy to the ticket.
 * The handoff must read the stamp the default apply wrote, so a new intake
 * ticket always gets its time-to-resolve clock.
 *
 * The conversation event bridge runs for real here (only the ticket bridge,
 * realtime and notify are stubbed), because the default apply lives inside it.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type SlaPolicyId,
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

// The shared kv cache is a committed table, so a settings row another suite
// cached there would hide this suite's default policy. Every read goes to the
// rolled-back transaction instead.
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheDel: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))

// ticket.created is fired without an await after intake returns; stubbing it
// keeps that work from touching the database after the rollback.
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
  emitTicketExternalStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../conversation/conversation.notify', () => ({
  notifyVisitorMessage: vi.fn().mockResolvedValue(undefined),
  notifyAgentReply: vi.fn().mockResolvedValue(undefined),
  notifyConversationStarted: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  events,
  principal,
  settings,
  slaEvents,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  and,
  eq,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { getOrCreateTestCustomer } from '@/lib/server/test-customer'
import { createSlaPolicy, softDeleteSlaPolicy } from '../../sla/sla-policy.service'
import type { TicketSlaApplied } from '../../sla/ticket-sla.service'
import {
  getDefaultSlaPolicySettings,
  updateDefaultSlaPolicySettings,
} from '../../settings/settings.sla-default'
import { applySlaToConversation } from '../../sla/sla.service'
import { createMyTicket } from '../requester.service'
import { createTicket } from '../ticket.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'user' | 'member' | 'admin'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `U-${suffix()}`, email: `${userId}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    createdAt: new Date(),
  })
  return principalId
}

function requesterActor(principalId: PrincipalId): Actor {
  return { ...ANONYMOUS_ACTOR, principalId, principalType: 'user' }
}

/** The REST and MCP shape: a workspace key acting with a team role. */
function serviceActor(principalId: PrincipalId): Actor {
  return { principalId, role: 'member', principalType: 'service', segmentIds: new Set() }
}

/** A teammate in the admin inbox. */
function teammateActor(principalId: PrincipalId): Actor {
  return { principalId, role: 'admin', principalType: 'user', segmentIds: new Set() }
}

async function seedWorkspace(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    id: createId('ticket_status') as TicketStatusId,
    name: 'Received',
    slug: `received_${suffix()}`,
    category: 'open',
    publicStage: 'received',
    position: 100,
    isDefault: true,
  })
}

async function seedDefaultPolicy(): Promise<SlaPolicyId> {
  const policy = await createSlaPolicy({
    name: 'Acme default',
    firstResponseTargetSecs: 3600,
    timeToResolveTargetSecs: 86_400,
  })
  await updateDefaultSlaPolicySettings({ policyId: policy.id })
  return policy.id as SlaPolicyId
}

async function readPair(ticketId: TicketId) {
  const [link] = await testDb
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  expect(link).toBeDefined()
  const conversationId = link!.conversationId as ConversationId
  const [conversation] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  const [ticket] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return { conversationId, conversation: conversation!, ticket: ticket! }
}

async function appliedEventCount(conversationId: ConversationId): Promise<number> {
  const rows = await testDb
    .select({ id: slaEvents.id })
    .from(slaEvents)
    .where(and(eq(slaEvents.conversationId, conversationId), eq(slaEvents.kind, 'applied')))
  return rows.length
}

async function conversationCreatedCount(conversationId: ConversationId): Promise<number> {
  const rows = await testDb
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.type, 'conversation.created'), eq(events.entityId, conversationId)))
  return rows.length
}

/** The default SLA landed on the conversation and the ticket runs a TTR clock
 *  from the same policy, with a deadline after intake. */
async function expectDefaultSlaOnPair(ticketId: TicketId, policyId: SlaPolicyId, before: Date) {
  const pair = await readPair(ticketId)
  expect(pair.conversation.slaApplied).toMatchObject({ policyId })
  expect(pair.ticket.slaApplied).toMatchObject({ policyId })
  const stamp = pair.ticket.slaApplied as TicketSlaApplied
  expect(new Date(stamp.timeToResolveDueAt).getTime()).toBeGreaterThan(before.getTime())
  expect(stamp.resolvedAt ?? null).toBeNull()
  expect(stamp.resolutionBreachedAt ?? null).toBeNull()
  expect(await appliedEventCount(pair.conversationId)).toBe(1)
  return pair
}

describe.skipIf(!fixture.available)('default SLA on ticket intake (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a portal or widget ticket gets the default SLA and a running TTR clock', async () => {
    await seedWorkspace()
    const policyId = await seedDefaultPolicy()
    const requester = await seedPrincipal('user')
    const before = new Date()

    const dto = await createMyTicket(requesterActor(requester), {
      title: 'Cannot export my data',
      description: 'The export button spins forever.',
    })

    await expectDefaultSlaOnPair(dto.id as TicketId, policyId, before)
  })

  it('a REST or MCP ticket with a requester gets the default SLA and a running TTR clock', async () => {
    await seedWorkspace()
    const policyId = await seedDefaultPolicy()
    const requester = await seedPrincipal('user')
    const keyPrincipal = await seedPrincipal('member')
    const before = new Date()

    const dto = await createTicket(
      {
        type: 'customer',
        title: 'Invoice is wrong',
        description: 'Charged twice.',
        requesterPrincipalId: requester,
        withBackingConversation: true,
      },
      serviceActor(keyPrincipal)
    )

    await expectDefaultSlaOnPair(dto.id as TicketId, policyId, before)
  })

  it('a teammate-created customer ticket with a requester takes the intake path and gets the clock', async () => {
    await seedWorkspace()
    const policyId = await seedDefaultPolicy()
    const requester = await seedPrincipal('user')
    const teammate = await seedPrincipal('admin')
    const before = new Date()

    const dto = await createTicket(
      { type: 'customer', title: 'Logged on behalf', requesterPrincipalId: requester },
      teammateActor(teammate)
    )

    await expectDefaultSlaOnPair(dto.id as TicketId, policyId, before)
  })

  it('applies the default once and dispatches conversation.created once per intake', async () => {
    await seedWorkspace()
    await seedDefaultPolicy()
    const requester = await seedPrincipal('user')

    const dto = await createMyTicket(requesterActor(requester), { title: 'Once only' })

    const { conversationId } = await readPair(dto.id as TicketId)
    expect(await appliedEventCount(conversationId)).toBe(1)
    expect(await conversationCreatedCount(conversationId)).toBe(1)
  })

  it('a test customer ticket gets no SLA on either side', async () => {
    await seedWorkspace()
    await seedDefaultPolicy()
    const owner = await seedPrincipal('admin')
    const testCustomer = (await getOrCreateTestCustomer(owner, 'en')).id as PrincipalId

    const dto = await createMyTicket(requesterActor(testCustomer), { title: 'Trying it out' })

    const pair = await readPair(dto.id as TicketId)
    expect(pair.conversation.slaApplied).toBeNull()
    expect(pair.ticket.slaApplied).toBeNull()
    expect(await appliedEventCount(pair.conversationId)).toBe(0)
  })

  it('a default apply that throws still creates the ticket, with no SLA', async () => {
    await seedWorkspace()
    const policyId = await seedDefaultPolicy()
    // The default still names the policy, but it is archived, so the apply
    // throws "policy not found".
    await softDeleteSlaPolicy(policyId)
    expect(await getDefaultSlaPolicySettings()).toEqual({ policyId })
    const requester = await seedPrincipal('user')

    const dto = await createMyTicket(requesterActor(requester), { title: 'Still filed' })

    const pair = await readPair(dto.id as TicketId)
    await expect(applySlaToConversation(pair.conversationId, policyId)).rejects.toThrow(/not found/)
    expect(pair.conversation.slaApplied).toBeNull()
    expect(pair.ticket.slaApplied).toBeNull()
    // The failed apply does not stop the conversation.created dispatch.
    expect(await conversationCreatedCount(pair.conversationId)).toBe(1)
  })
})
