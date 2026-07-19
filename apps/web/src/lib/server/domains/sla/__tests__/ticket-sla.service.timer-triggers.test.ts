/**
 * Real-DB coverage for the ticket-anchored TTR clock's two timer-driven
 * trigger scans (support platform §4.6): sweepApproachingTicketSlaBreaches /
 * sweepTicketSlaBreachTriggers. Both are CAS-guarded fire-once claims on
 * `tickets.sla_applied`, on DISTINCT marker fields from each other and from
 * the per-minute reporting sweep (sweepOverdueTicketSlaBreaches), so the
 * three never block one another — the same discipline the conversation side
 * keeps (see sla.service.timer-triggers.test.ts). A claimed candidate is only
 * RETURNED when the ticket has a linked CUSTOMER conversation to dispatch
 * against: a back-office ticket's marker is still claimed (fire-once holds)
 * but nothing is dispatched — the documented v1 limitation (see
 * ticket-sla.sweep.ts's resolveTicketTriggerTarget). The dispatch half is
 * workflow-sweep.ts's job and is covered there.
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
  tickets,
  ticketStatuses,
  ticketConversations,
  conversations,
  slaEvents,
  slaPolicies,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const workspaceHours = vi.hoisted(() => ({
  schedule: {
    enabled: false,
    timezone: 'UTC',
    intervals: [] as { day: number; start: string; end: string }[],
  },
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => workspaceHours.schedule),
}))

import { createSlaPolicy } from '../sla-policy.service'
import {
  applySlaToTicket,
  recordTicketResolution,
  pauseTicketSlaOnPending,
  resumeTicketSlaFromPending,
  type TicketSlaApplied,
} from '../ticket-sla.service'
import {
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  sweepOverdueTicketSlaBreaches,
} from '../ticket-sla.sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ slaApplied: tickets.slaApplied }).from(tickets).limit(0)
    await db.select({ ticketId: slaEvents.ticketId }).from(slaEvents).limit(0)
    await db.select({ ttr: slaPolicies.timeToResolveTargetSecs }).from(slaPolicies).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedStatus(
  category: 'open' | 'pending' | 'closed' = 'open'
): Promise<TicketStatusId> {
  const [row] = await testDb
    .insert(ticketStatuses)
    .values({ name: `T-${category}-${suffix()}`, slug: `t_${category}_${suffix()}`, category })
    .returning()
  return row.id
}

/** Seed a ticket of the given type; when `linked` is true, also seed the
 *  conversation it is CUSTOMER-linked to and return both. */
async function seedTicket(opts?: {
  type?: 'customer' | 'back_office'
  linked?: boolean
}): Promise<{ ticketId: TicketId; conversationId: ConversationId | null }> {
  const statusId = await seedStatus()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ type: opts?.type ?? 'customer', title: `Ticket-${suffix()}`, statusId })
    .returning()
  if (!opts?.linked) return { ticketId: ticket.id, conversationId: null }

  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [conv] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    .returning()
  await testDb.insert(ticketConversations).values({
    ticketId: ticket.id,
    conversationId: conv.id,
    ticketType: 'customer',
  })
  return { ticketId: ticket.id, conversationId: conv.id }
}

async function loadStamp(ticketId: TicketId): Promise<TicketSlaApplied | null> {
  const [row] = await testDb
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return (row?.slaApplied as TicketSlaApplied | undefined) ?? null
}

/** The EventConversationRef a plain seeded conversation resolves to (status
 *  'open', channel 'messenger', priority 'none', unassigned). */
function conversationRef(conversationId: ConversationId) {
  return {
    id: conversationId,
    status: 'open',
    channel: 'messenger',
    priority: 'none',
    assignedTeamId: null,
  }
}

describe.skipIf(!fixture.available)('ticket SLA timer-trigger scans (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)

  describe('sweepApproachingTicketSlaBreaches', () => {
    it('claims a linked ticket whose TTR clock enters the lead window, once', async () => {
      const { ticketId, conversationId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      // Due 11:00. At 10:50, 10 minutes out — inside a 15-minute lead window.
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const first = await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect(first).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId!),
          ticketId,
          ticket: {
            id: ticketId,
            number: expect.any(Number),
            type: 'customer',
            priority: 'none',
            assignedPrincipalId: null,
            assignedTeamId: null,
          },
          policyId: policy.id,
          clock: 'time_to_resolve',
          dueAt: '2026-01-05T11:00:00.000Z',
        },
      ])

      // A re-scan (same tick or a later one, still before due) must not re-claim.
      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:55:00Z'))).toEqual(
        []
      )

      const stamp = await loadStamp(ticketId)
      expect(stamp?.resolutionWarningFiredAt).toBe('2026-01-05T10:50:00.000Z')
    })

    it('does not claim a clock still outside the lead window, or one already past due', async () => {
      const { ticketId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // 30 minutes left, outside a 15-minute lead.
      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:30:00Z'))).toEqual(
        []
      )
      // Past due — that is sla.breached's job, not a warning.
      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T11:05:00Z'))).toEqual(
        []
      )
    })

    it('never claims a settled clock', async () => {
      const { ticketId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
      await recordTicketResolution(ticketId, new Date('2026-01-05T10:45:00Z'))

      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual(
        []
      )
    })

    it('never claims a currently-paused clock, and claims against the pause-shifted deadline after a resume', async () => {
      const { ticketId, conversationId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
      // Paused 10:20 -> 10:50 (30 min): due shifts from 11:00 to 11:30.
      await pauseTicketSlaOnPending(ticketId, new Date('2026-01-05T10:20:00Z'))

      // The stamped due date (11:00) is inside the lead window at 10:50, but paused.
      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual(
        []
      )

      await resumeTicketSlaFromPending(ticketId, new Date('2026-01-05T10:50:00Z'))
      // Inside the shifted window (15 min before 11:30).
      const claimed = await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T11:16:00Z'))
      expect(claimed).toEqual([
        expect.objectContaining({
          conversationId,
          ticketId,
          clock: 'time_to_resolve',
          dueAt: '2026-01-05T11:30:00.000Z',
        }),
      ])
    })

    it('does not block, or get blocked by, the per-minute breach-reporting sweep (distinct marker fields)', async () => {
      const { ticketId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // Warning fires first (10:50), then the clock actually breaches (11:05) —
      // the reporting sweep's own claim must still succeed independently.
      await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))
      expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(
        1
      )
    })

    it("claims a back-office ticket's marker without returning a dispatch candidate (documented v1 limitation)", async () => {
      // A back-office ticket has no linked CUSTOMER conversation, so there is
      // no conversation context to run a workflow against. The fire-once
      // marker is still claimed — a later tick must not re-attempt a dispatch
      // that can never succeed — and the reporting sweep still records the
      // breach itself (see ticket-sla.service.test.ts).
      const { ticketId } = await seedTicket({ type: 'back_office' })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepApproachingTicketSlaBreaches(15, new Date('2026-01-05T10:50:00Z'))).toEqual(
        []
      )
      // ...but the marker WAS claimed (fire-once holds without a dispatch).
      const stamp = await loadStamp(ticketId)
      expect(stamp?.resolutionWarningFiredAt).toBe('2026-01-05T10:50:00.000Z')
    })
  })

  describe('sweepTicketSlaBreachTriggers', () => {
    it('claims an overdue, unsettled TTR clock exactly once', async () => {
      const { ticketId, conversationId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      const first = await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))
      expect(first).toEqual([
        {
          conversationId,
          conversation: conversationRef(conversationId!),
          ticketId,
          ticket: {
            id: ticketId,
            number: expect.any(Number),
            type: 'customer',
            priority: 'none',
            assignedPrincipalId: null,
            assignedTeamId: null,
          },
          policyId: policy.id,
          clock: 'time_to_resolve',
          dueAt: '2026-01-05T11:00:00.000Z',
        },
      ])
      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:10:00Z'))).toEqual([])
    })

    it('does not claim a clock not yet due, a settled clock, or a paused one', async () => {
      const notDue = await seedTicket({ linked: true })
      const settled = await seedTicket({ linked: true })
      const paused = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      for (const { ticketId } of [notDue, settled, paused]) {
        await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))
      }
      await recordTicketResolution(settled.ticketId, new Date('2026-01-05T10:45:00Z'))
      await pauseTicketSlaOnPending(paused.ticketId, new Date('2026-01-05T10:30:00Z'))

      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T10:45:00Z'))).toEqual([])
      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))).toEqual([
        expect.objectContaining({ ticketId: notDue.ticketId }),
      ])
    })

    it('is independent of the per-minute breach-reporting sweep having already claimed its own marker', async () => {
      const { ticketId } = await seedTicket({ linked: true })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      // The per-minute reporting sweep claims its own marker first...
      expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:05:00Z'))).recorded).toBe(
        1
      )
      // ...but the trigger sweep still fires once off its own, distinct marker.
      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:06:00Z'))).toHaveLength(1)
      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:07:00Z'))).toEqual([])
    })

    it("claims a back-office ticket's marker without returning a dispatch candidate (documented v1 limitation)", async () => {
      const { ticketId } = await seedTicket({ type: 'back_office' })
      const policy = await createSlaPolicy({ name: 'TTR', timeToResolveTargetSecs: 3600 })
      await applySlaToTicket(ticketId, policy.id, new Date('2026-01-05T10:00:00Z'))

      expect(await sweepTicketSlaBreachTriggers(new Date('2026-01-05T11:05:00Z'))).toEqual([])
      const stamp = await loadStamp(ticketId)
      expect(stamp?.resolutionBreachTriggerFiredAt).toBe('2026-01-05T11:05:00.000Z')
      // And the breach itself is still recorded (the reporting axis needs no
      // conversation): the marker claim above doesn't consume the reporting
      // sweep's own, distinct marker.
      expect((await sweepOverdueTicketSlaBreaches(new Date('2026-01-05T11:06:00Z'))).recorded).toBe(
        1
      )
      const kinds = (
        await testDb.select().from(slaEvents).where(eq(slaEvents.ticketId, ticketId))
      ).map((e) => e.kind)
      expect(kinds).toContain('time_to_resolve_breached')
    })
  })
})
