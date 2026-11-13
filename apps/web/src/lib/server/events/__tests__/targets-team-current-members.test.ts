/**
 * Real-DB coverage for the notification rule: a notification meant for the team
 * reaches only current team members, and a watcher who is not a current team
 * member is notified only as the ticket's requester.
 *
 * Principals of every kind are seeded (current teammate, former teammate with a
 * leftover subscription and team row, requester, an unrelated portal user) and
 * the assertions are on the resolved recipients, so the role filter in the
 * watcher and team-roster queries is what is under test. Only the support flag
 * and stage labels are stubbed. Runs inside the db-test-fixture rollback
 * transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TicketId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketSubscriptions,
  teams,
  teamMembers,
  principal,
  user,
  and,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isSupportTicketsEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: async () => ({ received: 'Received', resolved: 'Resolved' }),
}))

import type { EventData } from '../types'
import type { HookContext } from '../hook-context'
import type { TeamId } from '@quackback/ids'
import {
  getTicketRepliedEmailTargets,
  getTicketResolvedEmailTargets,
  getTicketStatusChangedTargets,
  getTicketAssignedEmailTargets,
} from '../targets'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketSubscriptions.id }).from(ticketSubscriptions).limit(0)
    await db.select({ id: teamMembers.id }).from(teamMembers).limit(0)
  },
})

const context = {
  portalBaseUrl: 'https://p',
  workspaceName: 'W',
  logoUrl: null,
} as unknown as HookContext

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(
  label: string,
  role: 'admin' | 'member' | 'user'
): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${label}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: label, email })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return { id, email }
}

async function seedTicket(type: 'customer' | 'back_office', requester: PrincipalId) {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `open_${suffix()}`, category: 'open', position: 300 })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ type, title: 'Cannot log in', statusId: status.id, requesterPrincipalId: requester })
    .returning()
  return ticket.id as TicketId
}

async function watch(
  ticketId: TicketId,
  principalId: PrincipalId,
  reason: 'requester' | 'assignee' | 'replier' | 'manual'
) {
  await testDb.insert(ticketSubscriptions).values({ ticketId, principalId, reason })
}

interface World {
  ticketId: TicketId
  requester: { id: PrincipalId; email: string }
  current: { id: PrincipalId; email: string }
  former: { id: PrincipalId; email: string }
  stranger: { id: PrincipalId; email: string }
  actor: { id: PrincipalId; email: string }
}

async function seedWorld(type: 'customer' | 'back_office'): Promise<World> {
  const requester = await seedPrincipal('requester', 'user')
  const current = await seedPrincipal('current', 'member')
  const former = await seedPrincipal('former', 'user')
  const stranger = await seedPrincipal('stranger', 'user')
  const actor = await seedPrincipal('actor', 'admin')
  const ticketId = await seedTicket(type, requester.id)
  await watch(ticketId, requester.id, 'requester')
  await watch(ticketId, current.id, 'assignee')
  await watch(ticketId, former.id, 'assignee')
  await watch(ticketId, stranger.id, 'manual')
  await watch(ticketId, actor.id, 'replier')
  return { ticketId, requester, current, former, stranger, actor }
}

function ticketRef(w: World, type: string) {
  return { id: w.ticketId, number: 1, type, priority: 'none', assignedTeamId: null }
}

function repliedEvent(w: World, type: string): EventData {
  return {
    id: 'evt-r',
    type: 'ticket.replied',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: w.actor.id },
    data: {
      ticket: ticketRef(w, type),
      messageId: 'conversation_message_1',
      content: 'Fix is queued.',
      attachments: null,
      senderType: 'agent',
      title: 'Cannot log in',
      authorName: 'Sarah',
      requesterPrincipalId: w.requester.id,
    },
  } as EventData
}

function closedEvent(w: World, type: string): EventData {
  return {
    id: 'evt-s',
    type: 'ticket.status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: w.actor.id },
    data: {
      ticket: ticketRef(w, type),
      previousStatus: 'open',
      newStatus: 'closed',
      stage: 'resolved',
      previousStage: 'received',
      requesterPrincipalId: w.requester.id,
      title: 'Cannot log in',
    },
  } as EventData
}

const emailsOf = (targets: { target: unknown }[]) =>
  targets.map((t) => (t.target as { email: string }).email).sort()

describe.skipIf(!fixture.available)('team notifications reach current members only', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reply email on a customer ticket: current teammate and requester only', async () => {
    const w = await seedWorld('customer')
    const targets = await getTicketRepliedEmailTargets(repliedEvent(w, 'customer'), context)
    expect(emailsOf(targets)).toEqual([w.current.email, w.requester.email].sort())
    const byEmail = Object.fromEntries(
      targets.map((t) => [(t.target as { email: string }).email, t.config])
    )
    expect(byEmail[w.current.email]).toMatchObject({
      ctaUrl: `https://p/admin/inbox?i=${w.ticketId}`,
    })
    expect(byEmail[w.requester.email]).toMatchObject({ ctaUrl: 'https://p/support' })
  })

  it('resolution email on a customer ticket: current teammate and requester only', async () => {
    const w = await seedWorld('customer')
    const targets = await getTicketResolvedEmailTargets(closedEvent(w, 'customer'), context)
    expect(emailsOf(targets)).toEqual([w.current.email, w.requester.email].sort())
  })

  it('a back-office ticket never emails its nominal requester', async () => {
    const w = await seedWorld('back_office')
    const replied = await getTicketRepliedEmailTargets(repliedEvent(w, 'back_office'), context)
    expect(emailsOf(replied)).toEqual([w.current.email])
    const resolved = await getTicketResolvedEmailTargets(closedEvent(w, 'back_office'), context)
    expect(emailsOf(resolved)).toEqual([w.current.email])
  })

  it('a muted requester is not emailed', async () => {
    const w = await seedWorld('customer')
    await testDb
      .update(ticketSubscriptions)
      .set({ mutedUntil: new Date(Date.now() + 3_600_000) })
      .where(
        and(
          eq(ticketSubscriptions.ticketId, w.ticketId),
          eq(ticketSubscriptions.principalId, w.requester.id)
        )
      )
    const targets = await getTicketRepliedEmailTargets(repliedEvent(w, 'customer'), context)
    expect(emailsOf(targets)).toEqual([w.current.email])
  })

  it('status bell: current teammates and the requester, never a former teammate', async () => {
    const w = await seedWorld('customer')
    const target = await getTicketStatusChangedTargets(closedEvent(w, 'customer'))
    const ids = (target?.target as { principalIds: string[] }).principalIds
    expect([...ids].sort()).toEqual([w.current.id, w.requester.id].sort())
  })

  it('status bell keeps the requester of a back-office ticket', async () => {
    const w = await seedWorld('back_office')
    const target = await getTicketStatusChangedTargets(closedEvent(w, 'back_office'))
    const ids = (target?.target as { principalIds: string[] }).principalIds
    expect([...ids].sort()).toEqual([w.current.id, w.requester.id].sort())
  })

  it('a ticket assigned to a team emails current members, not a removed one', async () => {
    const w = await seedWorld('customer')
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Team ${suffix()}` })
      .returning()
    await testDb.insert(teamMembers).values([
      { teamId: team.id, principalId: w.current.id },
      { teamId: team.id, principalId: w.former.id },
    ])
    const event = {
      id: 'evt-a',
      type: 'ticket.assigned',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: {
        ticket: ticketRef(w, 'customer'),
        assignedPrincipalId: null,
        previousPrincipalId: null,
        assignedTeamId: team.id as TeamId,
        previousTeamId: null,
      },
    } as unknown as EventData
    const targets = await getTicketAssignedEmailTargets(event, context)
    expect(emailsOf(targets)).toEqual([w.current.email])
  })
})
