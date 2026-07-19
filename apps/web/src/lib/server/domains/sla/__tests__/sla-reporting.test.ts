/**
 * Real-DB coverage for SLA reporting (§7): met/breached counts + the
 * attainment rate per clock (four clocks, conversation and ticket), per-policy
 * grouping, the day-of-week x hour breach heatmap, and time-after-miss
 * averages — all scoped to a date range. Fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  eq,
  slaEvents,
  slaPolicies,
  tickets,
  ticketStatuses,
  user,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  slaAttainment,
  slaAttainmentByPolicy,
  slaBreachHeatmap,
  slaTimeAfterMiss,
} from '../sla-reporting'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ ticketId: slaEvents.ticketId }).from(slaEvents).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const at = (iso: string) => new Date(iso)

const RANGE_FROM = at('2026-01-01T00:00:00Z')
const RANGE_TO = at('2026-02-01T00:00:00Z')

async function seedPolicy(name?: string): Promise<string> {
  const [policy] = await testDb
    .insert(slaPolicies)
    .values({ name: name ?? `P-${suffix()}` })
    .returning()
  return policy.id
}

async function seedConversationAndPolicy(): Promise<{
  conversationId: ConversationId
  policyId: string
}> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [conv] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    .returning()
  const policyId = await seedPolicy()
  return { conversationId: conv.id, policyId }
}

/** A ticket row to anchor time_to_resolve_* events (their conversation_id is NULL). */
async function seedTicket(): Promise<TicketId> {
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `sr-${suffix()}` })
  const ticketId = createId('ticket') as TicketId
  await testDb.insert(tickets).values({ id: ticketId, title: 'T', statusId })
  return ticketId
}

describe.skipIf(!fixture.available)('sla-reporting (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('slaAttainment', () => {
    it('counts met/breached per clock and computes the rate, scoped to the range', async () => {
      const { conversationId, policyId } = await seedConversationAndPolicy()
      const ticketId = await seedTicket()
      const ev = (kind: string, iso: string, extra: Record<string, unknown> = {}) => ({
        conversationId,
        policyId: policyId as never,
        kind,
        at: at(iso),
        ...extra,
      })
      await testDb.insert(slaEvents).values([
        ev('first_response_met', '2026-01-05T10:00:00Z'),
        ev('first_response_met', '2026-01-05T11:00:00Z'),
        ev('first_response_met', '2026-01-05T12:00:00Z'),
        ev('first_response_breached', '2026-01-05T13:00:00Z'),
        ev('next_response_met', '2026-01-05T13:30:00Z'),
        ev('next_response_breached', '2026-01-05T14:00:00Z'),
        ev('next_response_breached', '2026-01-05T14:30:00Z'),
        ev('resolution_met', '2026-01-05T15:00:00Z'),
        ev('resolution_breached', '2026-01-05T16:00:00Z'),
        // Ticket-anchored TTR clock: ticket_id set, conversation_id NULL.
        ev('time_to_resolve_met', '2026-01-05T17:00:00Z', { ticketId, conversationId: null }),
        // Non-settle kinds must not pollute attainment counts.
        ev('applied', '2026-01-05T09:00:00Z'),
        ev('first_response_settled_after_breach', '2026-01-05T18:00:00Z', {
          meta: { overdueSecs: 600 },
        }),
        // Outside the range — must not count.
        ev('first_response_breached', '2026-02-01T10:00:00Z'),
      ])

      const res = await slaAttainment(RANGE_FROM, RANGE_TO)
      expect(res.firstResponse).toEqual({ met: 3, breached: 1, rate: 0.75 })
      expect(res.nextResponse).toEqual({ met: 1, breached: 2, rate: 1 / 3 })
      expect(res.resolution).toEqual({ met: 1, breached: 1, rate: 0.5 })
      expect(res.timeToResolve).toEqual({ met: 1, breached: 0, rate: 1 })
    })

    it('reports a null rate for a clock with no events', async () => {
      const res = await slaAttainment(at('2026-01-01T00:00:00Z'), at('2026-01-02T00:00:00Z'))
      expect(res.firstResponse).toEqual({ met: 0, breached: 0, rate: null })
      expect(res.nextResponse).toEqual({ met: 0, breached: 0, rate: null })
      expect(res.resolution).toEqual({ met: 0, breached: 0, rate: null })
      expect(res.timeToResolve).toEqual({ met: 0, breached: 0, rate: null })
    })
  })

  describe('slaAttainmentByPolicy', () => {
    it('groups attainment per policy and keeps a soft-deleted policy name', async () => {
      const { conversationId } = await seedConversationAndPolicy()
      const s = suffix()
      const policyA = await seedPolicy(`A-${s}`)
      const policyZ = await seedPolicy(`Z-${s}`)
      // Soft-delete policy A after it produced events — history keeps its name.
      await testDb
        .update(slaPolicies)
        .set({ deletedAt: new Date() })
        .where(eq(slaPolicies.id, policyA as never))

      const ev = (policyId: string, kind: string, iso: string) => ({
        conversationId,
        policyId: policyId as never,
        kind,
        at: at(iso),
      })
      await testDb.insert(slaEvents).values([
        ev(policyA, 'first_response_met', '2026-01-05T10:00:00Z'),
        ev(policyA, 'first_response_met', '2026-01-05T11:00:00Z'),
        ev(policyA, 'first_response_breached', '2026-01-05T12:00:00Z'),
        ev(policyZ, 'resolution_met', '2026-01-05T13:00:00Z'),
        // Policy A event outside the range — must not count.
        ev(policyA, 'first_response_met', '2026-02-01T10:00:00Z'),
      ])

      const res = await slaAttainmentByPolicy(RANGE_FROM, RANGE_TO)
      expect(res.map((r) => r.policyName)).toEqual([`A-${s}`, `Z-${s}`])
      expect(res[0]).toMatchObject({
        policyId: policyA,
        firstResponse: { met: 2, breached: 1, rate: 2 / 3 },
        nextResponse: { met: 0, breached: 0, rate: null },
        resolution: { met: 0, breached: 0, rate: null },
        timeToResolve: { met: 0, breached: 0, rate: null },
      })
      expect(res[1]).toMatchObject({
        policyId: policyZ,
        firstResponse: { met: 0, breached: 0, rate: null },
        resolution: { met: 1, breached: 0, rate: 1 },
      })
    })

    it('omits policies with no events in range', async () => {
      const { conversationId } = await seedConversationAndPolicy()
      const silentPolicy = await seedPolicy()
      const activePolicy = await seedPolicy()
      await testDb.insert(slaEvents).values({
        conversationId,
        policyId: activePolicy as never,
        kind: 'first_response_met',
        at: at('2026-01-05T10:00:00Z'),
      })

      const res = await slaAttainmentByPolicy(RANGE_FROM, RANGE_TO)
      expect(res.map((r) => r.policyId)).toEqual([activePolicy])
      expect(res.some((r) => r.policyId === silentPolicy)).toBe(false)
    })
  })

  describe('slaBreachHeatmap', () => {
    it('buckets breach events by ISO day-of-week and hour (UTC), per clock', async () => {
      const { conversationId, policyId } = await seedConversationAndPolicy()
      const ticketId = await seedTicket()
      const ev = (kind: string, iso: string, extra: Record<string, unknown> = {}) => ({
        conversationId,
        policyId: policyId as never,
        kind,
        at: at(iso),
        ...extra,
      })
      await testDb.insert(slaEvents).values([
        // 2026-01-05 is a Monday (ISODOW 1); both 10:xx events share a cell.
        ev('first_response_breached', '2026-01-05T10:15:00Z'),
        ev('resolution_breached', '2026-01-05T10:45:00Z'),
        // 2026-01-07 is a Wednesday (ISODOW 3); ticket-anchored TTR breach.
        ev('time_to_resolve_breached', '2026-01-07T23:05:00Z', {
          ticketId,
          conversationId: null,
        }),
        // Non-breach kinds never land on the heatmap.
        ev('first_response_met', '2026-01-05T11:00:00Z'),
        ev('first_response_settled_after_breach', '2026-01-05T12:00:00Z', {
          meta: { overdueSecs: 300 },
        }),
        ev('applied', '2026-01-05T09:00:00Z'),
        // Outside the range.
        ev('first_response_breached', '2026-02-02T10:00:00Z'),
      ])

      const res = await slaBreachHeatmap(RANGE_FROM, RANGE_TO)
      expect(res).toEqual([
        {
          dow: 1,
          hour: 10,
          count: 2,
          byClock: { firstResponse: 1, nextResponse: 0, resolution: 1, timeToResolve: 0 },
        },
        {
          dow: 3,
          hour: 23,
          count: 1,
          byClock: { firstResponse: 0, nextResponse: 0, resolution: 0, timeToResolve: 1 },
        },
      ])
    })

    it('returns no cells when nothing breached in range', async () => {
      const res = await slaBreachHeatmap(RANGE_FROM, RANGE_TO)
      expect(res).toEqual([])
    })
  })

  describe('slaTimeAfterMiss', () => {
    it('averages meta.overdueSecs per clock over settle-after-breach events', async () => {
      const { conversationId, policyId } = await seedConversationAndPolicy()
      const ticketId = await seedTicket()
      const ev = (kind: string, iso: string, overdueSecs: number, extra = {}) => ({
        conversationId,
        policyId: policyId as never,
        kind,
        at: at(iso),
        meta: { overdueSecs },
        ...extra,
      })
      await testDb.insert(slaEvents).values([
        ev('first_response_settled_after_breach', '2026-01-05T10:00:00Z', 600),
        ev('first_response_settled_after_breach', '2026-01-05T11:00:00Z', 300),
        ev('time_to_resolve_settled_after_breach', '2026-01-06T10:00:00Z', 7200, {
          ticketId,
          conversationId: null,
        }),
        // A plain breach has no overdueSecs and must not count.
        {
          conversationId,
          policyId: policyId as never,
          kind: 'resolution_breached',
          at: at('2026-01-05T12:00:00Z'),
        },
        // Outside the range.
        ev('first_response_settled_after_breach', '2026-02-01T10:00:00Z', 9999),
      ])

      const res = await slaTimeAfterMiss(RANGE_FROM, RANGE_TO)
      expect(res.firstResponse).toEqual({ count: 2, avgOverdueSecs: 450 })
      expect(res.nextResponse).toEqual({ count: 0, avgOverdueSecs: null })
      expect(res.resolution).toEqual({ count: 0, avgOverdueSecs: null })
      expect(res.timeToResolve).toEqual({ count: 1, avgOverdueSecs: 7200 })
    })
  })
})
