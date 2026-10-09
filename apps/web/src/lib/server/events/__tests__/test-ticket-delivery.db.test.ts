import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  user,
  principal,
  tickets,
  ticketStatuses,
  ticketConversations,
  conversations,
  conversationMessages,
  events,
  eq,
  sql,
  type Ticket,
} from '@/lib/server/db'
import type { EventData } from '../types'
import type { HookHandler } from '../hook-types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { delivered } = vi.hoisted(() => ({ delivered: vi.fn() }))
vi.mock('@/lib/server/events/registry', () => ({
  getHook: async (hookType: string): Promise<HookHandler | undefined> => {
    if (hookType !== 'webhook') throw new Error(`Unexpected hook ${hookType}`)
    return {
      run: async (event, target, config, context) => {
        if (event.type !== 'ticket.assigned') throw new Error('Expected a ticket assignment')
        expect(target).toEqual({ url: 'https://example.com/events' })
        expect(config).toEqual({ testDelivery: true })
        expect(context?.jobId).toBe(event.id)
        delivered(event.data.ticket.id)
        return { success: true }
      },
    }
  },
}))

import { emit } from '../emit'
import { ticketAssigned } from '../catalogue/ticket'
import { runHookJob } from '../hook-job'
import { isTestEvent } from '../test-event'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

const fixture = await createDbTestFixture()
let owner: PrincipalId
let rows: Record<
  'real' | 'marked' | 'requester' | 'markedConversation' | 'testConversation',
  Ticket
>

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:_\w+)?(?:\?|$)/)
  await fixture.begin()
  delivered.mockClear()
  owner = createId('principal')
  const ownerUser = createId('user'),
    customer = createId('principal'),
    ordinary = createId('principal')
  await testDb
    .insert(user)
    .values({ id: ownerUser, name: 'Acme', email: `you+${ownerUser}@example.com` })
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: ordinary, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  await testDb.insert(principal).values({
    id: customer,
    type: 'anonymous',
    role: 'user',
    testOwnerPrincipalId: owner,
    createdAt: new Date(),
  })
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme open', slug: createId('ticket_status') })
    .returning()
  const [real, marked, requester, markedConversation, testConversation] = await testDb
    .insert(tickets)
    .values([
      { title: 'Acme real request', statusId: status.id, requesterPrincipalId: ordinary },
      {
        title: 'Acme marked request',
        statusId: status.id,
        requesterPrincipalId: ordinary,
        customAttributes: { test: true },
      },
      { title: 'Acme test customer request', statusId: status.id, requesterPrincipalId: customer },
      {
        title: 'Acme marked conversation request',
        statusId: status.id,
        requesterPrincipalId: ordinary,
      },
      {
        title: 'Acme test conversation request',
        statusId: status.id,
        requesterPrincipalId: ordinary,
      },
    ])
    .returning()
  rows = { real, marked, requester, markedConversation, testConversation }
  const [markedThread, testThread] = await testDb
    .insert(conversations)
    .values([
      {
        visitorPrincipalId: owner,
        channel: 'messenger',
        customAttributes: { test: true, testOwnerPrincipalId: owner },
      },
      { visitorPrincipalId: customer, channel: 'messenger' },
    ])
    .returning()
  await testDb.insert(ticketConversations).values([
    { ticketId: markedConversation.id, conversationId: markedThread.id, ticketType: 'customer' },
    { ticketId: testConversation.id, conversationId: testThread.id, ticketType: 'customer' },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

function assignment(ticket: Ticket): EventData & { type: 'ticket.assigned' } {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: owner },
    type: 'ticket.assigned',
    data: {
      ticket: {
        id: ticket.id,
        number: ticket.number,
        type: ticket.type,
        priority: ticket.priority,
      },
      assignedPrincipalId: owner,
      previousPrincipalId: null,
      assignedTeamId: null,
      previousTeamId: null,
    },
  }
}

it.each(['requester', 'testConversation'] as const)(
  'keeps %s ticket events in the outbox without a delivery or reaction job',
  async (kind) => {
    const event = assignment(rows[kind])
    const id = await emit(testDb, ticketAssigned, {
      entityId: rows[kind].id,
      payload: { ...event.data },
      actor: { type: 'user', id: owner },
    })
    const stored = await testDb.query.events.findFirst({ where: eq(events.eventId, id) })
    expect(stored?.publishedAt).toBeInstanceOf(Date)
    const jobs = getExecuteRows(
      await testDb.execute(sql`SELECT queue FROM job_queue WHERE payload->>'eventId' = ${id}`)
    )
    expect(jobs).toEqual([])
  }
)

it.each(['requester', 'testConversation'] as const)(
  'suppresses an already queued %s ticket webhook using its current stored provenance',
  async (kind) => {
    const event = assignment(rows[kind])
    const job: ClaimedJob = {
      id: '1',
      jobId: createId('job'),
      queue: 'events',
      dedupeKey: event.id,
      payload: {
        hookType: 'webhook',
        event,
        target: { url: 'https://example.com/events' },
        config: { testDelivery: true },
      },
      workspaceKey: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: crypto.randomUUID(),
      lockedUntil: new Date(Date.now() + 60_000),
      runAt: new Date(),
    }
    await runHookJob(job)
    expect(delivered).not.toHaveBeenCalled()
  }
)

it('recognizes a direct ticket reference without a payload and ignores an ordinary ticket', async () => {
  expect(await isTestEvent({ entityId: rows.requester.id, payload: {} })).toBe(true)
  expect(await isTestEvent({ entityId: rows.real.id, payload: {} })).toBe(false)
  expect(await isTestEvent({ payload: { ticketId: rows.requester.id } })).toBe(true)
})

it('uses the stored ticket parent of a teammate-authored message and keeps a real message eligible', async () => {
  const [testMessage, realMessage] = await testDb
    .insert(conversationMessages)
    .values([
      {
        ticketId: rows.requester.id,
        principalId: owner,
        senderType: 'agent',
        content: 'Acme test reply',
      },
      {
        ticketId: rows.real.id,
        principalId: owner,
        senderType: 'agent',
        content: 'Acme real reply',
      },
    ])
    .returning()
  expect(await isTestEvent({ entityId: testMessage.id, payload: {} })).toBe(true)
  expect(await isTestEvent({ payload: { messageId: testMessage.id }, actorId: owner })).toBe(true)
  expect(await isTestEvent({ entityId: realMessage.id, payload: {}, actorId: owner })).toBe(false)
  const event = assignment(rows.real)
  const job: ClaimedJob = {
    id: '1',
    jobId: createId('job'),
    queue: 'events',
    dedupeKey: event.id,
    payload: {
      hookType: 'webhook',
      event: { ...event, data: { ...event.data, messageId: testMessage.id } },
      target: { url: 'https://example.com/events' },
      config: { testDelivery: true },
    },
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 1,
    leaseToken: crypto.randomUUID(),
    lockedUntil: new Date(Date.now() + 60_000),
    runAt: new Date(),
  }
  await runHookJob(job)
  expect(delivered).not.toHaveBeenCalled()
  job.payload.event = { ...event, data: { ...event.data, messageId: realMessage.id } }
  await runHookJob(job)
  expect(delivered).toHaveBeenCalledExactlyOnceWith(rows.real.id)
})

// A legacy client `test` attribute, on the ticket or on a teammate's linked
// thread, is real data and must still be delivered.
it.each(['real', 'marked', 'markedConversation'] as const)(
  'continues to enqueue and deliver a %s ticket assignment',
  async (kind) => {
    const event = assignment(rows[kind])
    const id = await emit(testDb, ticketAssigned, {
      entityId: rows[kind].id,
      payload: { ...event.data },
      actor: { type: 'user', id: owner },
    })
    const stored = await testDb.query.events.findFirst({ where: eq(events.eventId, id) })
    expect(stored?.publishedAt).toBeNull()
    const jobs = getExecuteRows(
      await testDb.execute(sql`SELECT queue FROM job_queue WHERE payload->>'eventId' = ${id}`)
    )
    expect(jobs).toEqual([{ queue: 'event-dispatch' }])
    await runHookJob({
      id: '1',
      jobId: createId('job'),
      queue: 'events',
      dedupeKey: event.id,
      payload: {
        hookType: 'webhook',
        event,
        target: { url: 'https://example.com/events' },
        config: { testDelivery: true },
      },
      workspaceKey: null,
      attempts: 1,
      maxAttempts: 1,
      leaseToken: crypto.randomUUID(),
      lockedUntil: new Date(Date.now() + 60_000),
      runAt: new Date(),
    })
    expect(delivered).toHaveBeenCalledExactlyOnceWith(rows[kind].id)
  }
)
