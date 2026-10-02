import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type SlaPolicyId,
  type TicketId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  principal,
  user,
  slaEvents,
  tickets,
  ticketStatuses,
  ticketConversations,
  eq,
  inArray,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: async () => ({ enabled: false, timezone: 'UTC', intervals: [] }),
}))

import { getOrCreateTestCustomer } from '@/lib/server/test-customer'
import { createSlaPolicy } from '../sla-policy.service'
import {
  applySlaToConversation,
  loadSlaApplied,
  commitStamp,
  recordFirstResponse,
  type SlaApplied,
} from '../sla.service'
import {
  sweepOverdueSlaBreaches,
  sweepSlaBreachTriggers,
  sweepApproachingSlaBreaches,
} from '../sla.sweep'
import {
  slaAttainment,
  slaAttainmentByPolicy,
  slaBreachHeatmap,
  slaTimeAfterMiss,
} from '../sla-reporting'
import {
  applySlaToTicket,
  loadTicketSlaApplied,
  commitTicketStamp,
  type TicketSlaApplied,
} from '../ticket-sla.service'
import {
  sweepOverdueTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  sweepApproachingTicketSlaBreaches,
} from '../ticket-sla.sweep'

const fixture = await createDbTestFixture()
const started = new Date('2032-02-02T10:00:00.000Z')
const due = new Date('2032-02-02T11:00:00.000Z')
const later = new Date('2032-02-02T11:05:00.000Z')
const from = new Date('2032-02-02T00:00:00.000Z')
const to = new Date('2032-02-03T00:00:00.000Z')
let owner: PrincipalId, customer: PrincipalId, ordinary: PrincipalId, policyId: SlaPolicyId
let testId: ConversationId, teamTestId: ConversationId, realId: ConversationId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = createId('principal')
  ordinary = createId('principal')
  const ownerUser = createId('user')
  await testDb.insert(user).values({ id: ownerUser, name: 'Acme', email: 'you@example.com' })
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: ordinary, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  customer = (await getOrCreateTestCustomer(owner, 'en')).id
  policyId = (
    await createSlaPolicy({
      name: 'Acme',
      firstResponseTargetSecs: 3600,
      timeToResolveTargetSecs: 3600,
    })
  ).id
  const [test, teamTest, real] = await testDb
    .insert(conversations)
    .values([
      { visitorPrincipalId: customer, channel: 'messenger', customAttributes: {} },
      {
        visitorPrincipalId: owner,
        channel: 'messenger',
        customAttributes: { test: true, testOwnerPrincipalId: owner },
      },
      { visitorPrincipalId: ordinary, channel: 'messenger', customAttributes: {} },
    ])
    .returning()
  testId = test.id
  teamTestId = teamTest.id
  realId = real.id
})
afterEach(fixture.rollback)
afterAll(fixture.close)

function stamp(): SlaApplied {
  return {
    policyId,
    policyName: 'Acme',
    appliedAt: started.toISOString(),
    firstResponseDueAt: due.toISOString(),
    firstResponseAt: null,
    nextResponseTargetSecs: null,
    timeToCloseDueAt: null,
    pauseOnSnooze: true,
    pausedAt: null,
    pauseRevision: 0,
  }
}

async function seedStamps() {
  await testDb
    .update(conversations)
    .set({ slaApplied: stamp() })
    .where(inArray(conversations.id, [testId, teamTestId, realId]))
}

async function stored(id: ConversationId) {
  return (await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) }))!
    .slaApplied
}

it('rejects direct SLA application to both test identities and marked teammate conversations', async () => {
  await expect(applySlaToConversation(testId, policyId, started)).rejects.toThrow(/unavailable/i)
  await expect(applySlaToConversation(teamTestId, policyId, started)).rejects.toThrow(
    /unavailable/i
  )
  expect(await stored(testId)).toBeNull()
  expect(await stored(teamTestId)).toBeNull()
  expect(
    await testDb.query.slaEvents.findMany({
      where: inArray(slaEvents.conversationId, [testId, teamTestId]),
    })
  ).toHaveLength(0)
  expect(await applySlaToConversation(realId, policyId, started)).toMatchObject({ policyId })
  expect(await stored(realId)).toMatchObject({ policyId })
})

it('ignores legacy test stamps in lazy settlement and protects direct stamp mutations', async () => {
  await seedStamps()
  expect(await loadSlaApplied(testId)).toBeNull()
  expect(await loadSlaApplied(teamTestId)).toBeNull()
  expect(await loadSlaApplied(realId)).toEqual(stamp())
  await recordFirstResponse(testId, later)
  expect(await stored(testId)).toEqual(stamp())
  const guard = { appliedAt: started.toISOString(), pausedAt: null }
  expect(
    await commitStamp(teamTestId, { firstResponseAt: later.toISOString() }, later, guard)
  ).toBe(false)
  expect(await stored(teamTestId)).toEqual(stamp())
  expect(await commitStamp(realId, { firstResponseAt: later.toISOString() }, later, guard)).toBe(
    true
  )
})

it('excludes legacy test stamps from SLA warning and breach candidates', async () => {
  await seedStamps()
  const ourIds = [testId, teamTestId, realId]
  const warnings = await sweepApproachingSlaBreaches(10, new Date(due.getTime() - 5 * 60_000))
  expect(
    warnings
      .filter((candidate) => ourIds.includes(candidate.conversationId))
      .map((candidate) => candidate.conversationId)
  ).toEqual([realId])
  const breaches = await sweepSlaBreachTriggers(later)
  expect(
    breaches
      .filter((candidate) => ourIds.includes(candidate.conversationId))
      .map((candidate) => candidate.conversationId)
  ).toEqual([realId])
})

it('sweeps only its own real overdue conversation without changing test clocks', async () => {
  await seedStamps()
  expect(await sweepOverdueSlaBreaches(later, [testId, teamTestId, realId])).toEqual({
    recorded: 1,
  })
  expect(await stored(testId)).toEqual(stamp())
  expect(await stored(teamTestId)).toEqual(stamp())
  expect(await stored(realId)).toMatchObject({ firstResponseBreachedAt: later.toISOString() })
})

async function seedPairedTickets(): Promise<[TicketId, TicketId, TicketId]> {
  const statusId = createId('ticket_status')
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'Open', slug: String(statusId) })
  const rows = await testDb
    .insert(tickets)
    .values([
      { title: 'Acme', statusId, requesterPrincipalId: customer },
      { title: 'Acme', statusId, requesterPrincipalId: ordinary },
      { title: 'Acme', statusId, requesterPrincipalId: ordinary },
    ])
    .returning()
  await testDb.insert(ticketConversations).values(
    rows.map((ticket, index) => ({
      ticketId: ticket.id,
      conversationId: [testId, teamTestId, realId][index],
      ticketType: 'customer' as const,
    }))
  )
  return rows.map((ticket) => ticket.id) as [TicketId, TicketId, TicketId]
}

it('rejects direct ticket SLA application to test requesters and test conversation pairs', async () => {
  const [testTicket, pairedTestTicket, realTicket] = await seedPairedTickets()
  await expect(applySlaToTicket(testTicket, policyId, started)).rejects.toThrow(/not found/i)
  await expect(applySlaToTicket(pairedTestTicket, policyId, started)).rejects.toThrow(/not found/i)
  expect(await loadTicketSlaApplied(testTicket)).toBeNull()
  expect(await loadTicketSlaApplied(pairedTestTicket)).toBeNull()
  expect(await applySlaToTicket(realTicket, policyId, started)).toMatchObject({ policyId })
  expect(await loadTicketSlaApplied(realTicket)).toMatchObject({ policyId })
})

it('leaves legacy test ticket clocks unchanged in load, CAS, candidates and breach sweeps', async () => {
  const ids = await seedPairedTickets()
  const [testTicket, pairedTestTicket, realTicket] = ids
  const applied: TicketSlaApplied = {
    policyId,
    policyName: 'Acme',
    appliedAt: started.toISOString(),
    timeToResolveDueAt: due.toISOString(),
    resolvedAt: null,
  }
  await testDb.update(tickets).set({ slaApplied: applied }).where(inArray(tickets.id, ids))
  expect(await loadTicketSlaApplied(testTicket)).toBeNull()
  expect(await loadTicketSlaApplied(pairedTestTicket)).toBeNull()
  expect(
    await commitTicketStamp(testTicket, { resolvedAt: later.toISOString() }, later, {
      appliedAt: started.toISOString(),
      pausedAt: null,
    })
  ).toBe(false)
  const warnings = await sweepApproachingTicketSlaBreaches(
    10,
    new Date(due.getTime() - 5 * 60_000),
    ids
  )
  expect(warnings.map((candidate) => candidate.ticketId)).toEqual([realTicket])
  const candidates = await sweepTicketSlaBreachTriggers(later, ids)
  expect(candidates.map((candidate) => candidate.ticketId)).toEqual([realTicket])
  expect(await sweepOverdueTicketSlaBreaches(later, ids)).toEqual({ recorded: 1 })
  for (const id of [testTicket, pairedTestTicket]) {
    expect(
      (await testDb.query.tickets.findFirst({ where: eq(tickets.id, id) }))!.slaApplied
    ).toEqual(applied)
  }
  expect(await loadTicketSlaApplied(realTicket)).toMatchObject({
    resolutionBreachedAt: later.toISOString(),
  })
})

it('keeps legacy test SLA events out of all reports while retaining real conversation and ticket events', async () => {
  const statusId = createId('ticket_status')
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'Open', slug: String(statusId) })
  const [testTicket, pairedTestTicket, realTicket] = await testDb
    .insert(tickets)
    .values([
      { title: 'Acme', statusId, requesterPrincipalId: customer },
      { title: 'Acme', statusId, requesterPrincipalId: ordinary },
      { title: 'Acme', statusId, requesterPrincipalId: ordinary },
    ])
    .returning()
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: pairedTestTicket.id, conversationId: teamTestId, ticketType: 'customer' })
  const events = [
    { conversationId: testId, ticketId: null },
    { conversationId: teamTestId, ticketId: null },
    { conversationId: realId, ticketId: null },
    { conversationId: null, ticketId: testTicket.id },
    { conversationId: null, ticketId: pairedTestTicket.id },
    { conversationId: null, ticketId: realTicket.id },
  ]
  await testDb.insert(slaEvents).values(
    events.flatMap((subject) => {
      const clock = subject.ticketId ? 'time_to_resolve' : 'first_response'
      return [
        { ...subject, policyId, kind: `${clock}_breached`, at: later, meta: {} },
        {
          ...subject,
          policyId,
          kind: `${clock}_settled_after_breach`,
          at: later,
          meta: { overdueSecs: 300 },
        },
      ]
    })
  )
  const totals = await slaAttainment(from, to)
  expect(totals.firstResponse).toEqual({ met: 0, breached: 1, rate: 0 })
  expect(totals.timeToResolve).toEqual({ met: 0, breached: 1, rate: 0 })
  const byPolicy = (await slaAttainmentByPolicy(from, to)).find(
    (policy) => policy.policyId === policyId
  )
  expect(byPolicy?.firstResponse.breached).toBe(1)
  expect(byPolicy?.timeToResolve.breached).toBe(1)
  expect((await slaBreachHeatmap(from, to)).reduce((sum, cell) => sum + cell.count, 0)).toBe(2)
  const afterMiss = await slaTimeAfterMiss(from, to)
  expect(afterMiss.firstResponse).toEqual({ count: 1, avgOverdueSecs: 300 })
  expect(afterMiss.timeToResolve).toEqual({ count: 1, avgOverdueSecs: 300 })
})
