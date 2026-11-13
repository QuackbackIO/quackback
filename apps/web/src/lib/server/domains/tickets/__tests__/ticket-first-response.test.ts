/**
 * A ticket's first response, worked out from the message rows: the first
 * public, undeleted human reply written after the customer's first message,
 * across the ticket's own thread and, on a paired customer ticket, its
 * conversation. Real DB (rolled back); every message carries an explicit time,
 * because rows written in one test transaction would otherwise share `now()`.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
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

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  apiKeys,
  conversationMessages,
  conversations,
  principal,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  eq,
} from '@/lib/server/db'
import { recomputeTicketFirstResponse } from '../ticket-first-response'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ kind: apiKeys.kind }).from(apiKeys).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const at = (hhmm: string) => new Date(`2026-03-02T${hhmm}:00.000Z`)
const EDITED = new Date('2025-01-01T00:00:00.000Z')

async function seedPerson(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'member', type: 'user', createdAt: new Date() })
  return id
}

async function seedService(): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id, role: 'member', type: 'service', createdAt: new Date() })
  return id
}

async function seedKey(
  kind: 'personal' | 'workspace',
  opts: { createdById?: PrincipalId | null; revoked?: boolean } = {}
): Promise<PrincipalId> {
  const id = await seedService()
  await testDb.insert(apiKeys).values({
    name: `${kind} key`,
    keyHash: `${suffix()}${'0'.repeat(64)}`.slice(0, 64),
    keyPrefix: 'qb_test',
    createdById: opts.createdById ?? null,
    principalId: id,
    kind,
    revokedAt: opts.revoked ? new Date() : null,
  })
  return id
}

async function seedTicket(type: 'customer' | 'back_office' | 'tracker' = 'customer') {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `fr-${suffix()}` })
  const id = createId('ticket') as TicketId
  await testDb
    .insert(tickets)
    .values({ id, title: 'T', statusId, type, createdAt: EDITED, updatedAt: EDITED })
  return id
}

async function seedConversation(customer: PrincipalId): Promise<ConversationId> {
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning({ id: conversations.id })
  return row.id as ConversationId
}

async function link(ticketId: TicketId, conversationId: ConversationId, ticketType: string) {
  await testDb.insert(ticketConversations).values({
    ticketId,
    conversationId,
    ticketType: ticketType as 'customer',
  })
}

type Parent = { ticketId: TicketId } | { conversationId: ConversationId }

async function write(
  parent: Parent,
  senderType: 'visitor' | 'agent' | 'system',
  hhmm: string,
  principalId: PrincipalId | null,
  opts: { internal?: boolean; deleted?: boolean } = {}
) {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      ...parent,
      principalId,
      senderType,
      content: `${senderType} at ${hhmm}`,
      isInternal: opts.internal ?? false,
      deletedAt: opts.deleted ? at(hhmm) : null,
      createdAt: at(hhmm),
    })
    .returning({ id: conversationMessages.id })
  return row.id
}

async function readTicket(id: TicketId) {
  const [row] = await testDb
    .select({ firstResponseAt: tickets.firstResponseAt, updatedAt: tickets.updatedAt })
    .from(tickets)
    .where(eq(tickets.id, id))
  return row
}

async function firstResponse(id: TicketId): Promise<Date | null> {
  await recomputeTicketFirstResponse(id)
  return (await readTicket(id)).firstResponseAt
}

describe.skipIf(!fixture.available)('ticket first response from the message rows', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it("a teammate's public reply after the customer's message counts, and only the first", async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    await write({ ticketId }, 'visitor', '09:00', customer)
    await write({ ticketId }, 'agent', '09:30', teammate)
    await write({ ticketId }, 'agent', '10:00', teammate)
    expect(await firstResponse(ticketId)).toEqual(at('09:30'))
  })

  it('a note, a system row, a deleted reply and automated replies never count', async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const assistant = await seedService()
    const workspaceKey = await seedKey('workspace', { createdById: teammate })
    const ticketId = await seedTicket()
    await write({ ticketId }, 'visitor', '09:00', customer)
    await write({ ticketId }, 'agent', '09:05', teammate, { internal: true })
    await write({ ticketId }, 'system', '09:10', null)
    await write({ ticketId }, 'agent', '09:15', teammate, { deleted: true })
    await write({ ticketId }, 'agent', '09:20', assistant)
    await write({ ticketId }, 'agent', '09:25', workspaceKey)
    expect(await firstResponse(ticketId)).toBeNull()

    await write({ ticketId }, 'agent', '09:40', teammate)
    expect(await firstResponse(ticketId)).toEqual(at('09:40'))
  })

  for (const [label, opts] of [
    ['a personal key', {}],
    ['a revoked personal key', { revoked: true }],
    ['a personal key whose creator is gone', { createdById: null }],
  ] as const) {
    it(`a reply through ${label} counts as its creator's reply`, async () => {
      const [customer, teammate] = [await seedPerson(), await seedPerson()]
      const key = await seedKey('personal', { createdById: teammate, ...opts })
      const ticketId = await seedTicket()
      await write({ ticketId }, 'visitor', '09:00', customer)
      await write({ ticketId }, 'agent', '09:20', key)
      expect(await firstResponse(ticketId)).toEqual(at('09:20'))
    })
  }

  it("a teammate's opening on the ticket never counts, nor does a reply before the customer writes", async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    await write({ ticketId }, 'agent', '08:00', teammate)
    await write({ ticketId }, 'agent', '08:30', teammate)
    expect(await firstResponse(ticketId)).toBeNull()

    await write({ ticketId }, 'visitor', '09:00', customer)
    expect(await firstResponse(ticketId)).toBeNull()

    await write({ ticketId }, 'agent', '09:45', teammate)
    expect(await firstResponse(ticketId)).toEqual(at('09:45'))
  })

  it("a teammate's opening on the paired conversation never counts", async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    const conversationId = await seedConversation(customer)
    await link(ticketId, conversationId, 'customer')
    await write({ conversationId }, 'agent', '08:00', teammate)
    expect(await firstResponse(ticketId)).toBeNull()

    await write({ conversationId }, 'visitor', '09:00', customer)
    await write({ conversationId }, 'agent', '09:10', teammate)
    expect(await firstResponse(ticketId)).toEqual(at('09:10'))
  })

  it('a reply written in the same instant as the first customer message does not count', async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    await write({ ticketId }, 'agent', '09:00', teammate)
    await write({ ticketId }, 'visitor', '09:00', customer)
    expect(await firstResponse(ticketId)).toBeNull()
  })

  it("the customer's first message on either thread starts the clock, and replies on both count", async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    const conversationId = await seedConversation(customer)
    await link(ticketId, conversationId, 'customer')
    await write({ conversationId }, 'visitor', '09:00', customer)
    await write({ ticketId }, 'agent', '09:05', teammate)
    await write({ conversationId }, 'agent', '09:10', teammate)
    // The conversation's reply is earlier than the ticket's own creation time.
    expect(await firstResponse(ticketId)).toEqual(at('09:05'))
  })

  it("a provenance link never brings the conversation's replies to a back-office ticket", async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket('back_office')
    const conversationId = await seedConversation(customer)
    await link(ticketId, conversationId, 'back_office')
    await write({ conversationId }, 'visitor', '09:00', customer)
    await write({ conversationId }, 'agent', '09:10', teammate)
    await write({ ticketId }, 'agent', '09:20', teammate)
    expect(await firstResponse(ticketId)).toBeNull()
  })

  for (const type of ['back_office', 'tracker'] as const) {
    it(`a ${type} ticket a teammate filed as its requester never gets a value, and loses a stamped one`, async () => {
      const [filer, teammate] = [await seedPerson(), await seedPerson()]
      const ticketId = await seedTicket(type)
      await testDb
        .update(tickets)
        .set({ firstResponseAt: at('08:00') })
        .where(eq(tickets.id, ticketId))
      // The filer writes as the requester, then a teammate answers.
      await write({ ticketId }, 'visitor', '09:00', filer)
      await write({ ticketId }, 'agent', '09:30', teammate)
      expect(await firstResponse(ticketId)).toBeNull()
    })
  }

  it('deleting the first reply moves the value forward, and deleting the only reply clears it', async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    await write({ ticketId }, 'visitor', '09:00', customer)
    const first = await write({ ticketId }, 'agent', '09:10', teammate)
    const second = await write({ ticketId }, 'agent', '09:20', teammate)
    expect(await firstResponse(ticketId)).toEqual(at('09:10'))

    await testDb
      .update(conversationMessages)
      .set({ deletedAt: new Date() })
      .where(eq(conversationMessages.id, first))
    expect(await firstResponse(ticketId)).toEqual(at('09:20'))

    await testDb
      .update(conversationMessages)
      .set({ deletedAt: new Date() })
      .where(eq(conversationMessages.id, second))
    expect(await firstResponse(ticketId)).toBeNull()
  })

  it('replaces a stamped value that no reply supports, keeps updated_at, and a second run changes nothing', async () => {
    const [customer, teammate] = [await seedPerson(), await seedPerson()]
    const ticketId = await seedTicket()
    await testDb
      .update(tickets)
      .set({ firstResponseAt: at('08:00'), updatedAt: EDITED })
      .where(eq(tickets.id, ticketId))
    await write({ ticketId }, 'visitor', '09:00', customer)
    await write({ ticketId }, 'agent', '09:30', teammate)

    expect(await recomputeTicketFirstResponse(ticketId)).toEqual({
      id: ticketId,
      firstResponseAt: at('09:30'),
    })
    expect(await readTicket(ticketId)).toEqual({ firstResponseAt: at('09:30'), updatedAt: EDITED })

    expect(await recomputeTicketFirstResponse(ticketId)).toBeNull()
    expect(await readTicket(ticketId)).toEqual({ firstResponseAt: at('09:30'), updatedAt: EDITED })
  })
})
