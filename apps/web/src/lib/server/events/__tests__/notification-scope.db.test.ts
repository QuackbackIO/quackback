/**
 * Every inbox notice follows each recipient's own scope, over real rows.
 *
 * One world per test: a Billing team, a Logistics team, and teammates of every
 * shape (a workspace-wide manager, scoped teammates on and off the item's
 * team, a scoped direct assignee, a removed teammate now on role `user`, a
 * service principal holding view_all through a leftover assignment) plus the
 * customer. Each builder is driven with a real event and the assertions are on
 * the resolved recipients. Only the support flag, stage labels and presence
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { TeamId, TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, ticketSubscriptions, eq } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  SCOPED_KEYS,
  seedPerson,
  seedTeam,
  seedTicket,
  type SeededPerson,
} from '@/lib/server/__tests__/scope-seed'

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
import type { HookTarget } from '../hook-types'
import { getTicketNoteAddedTargets, getTicketRepliedTargets } from '../targets'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

interface World {
  billing: TeamId
  logistics: TeamId
  /** Legacy member: the Manager preset, view_all. */
  manager: SeededPerson
  /** Scoped, on Billing. */
  onTeam: SeededPerson
  /** Scoped, on Logistics. */
  elsewhere: SeededPerson
  /** Scoped, on no team: sees only what is assigned to them. */
  solo: SeededPerson
  /** Role user: a removed teammate, still on Billing and on old rows. */
  former: SeededPerson
  /** Not a teammate, yet holding view_all through a leftover assignment. */
  service: SeededPerson
  /** The teammate who acts (never notified). */
  actor: SeededPerson
  /** The customer. */
  requester: SeededPerson
}

async function seedWorld(): Promise<World> {
  const manager = await seedPerson('manager', 'member')
  const onTeam = await seedPerson('on-team', 'member', { keys: SCOPED_KEYS })
  const elsewhere = await seedPerson('elsewhere', 'member', { keys: SCOPED_KEYS })
  const solo = await seedPerson('solo', 'member', { keys: SCOPED_KEYS })
  const former = await seedPerson('former', 'user')
  const service = await seedPerson('service', 'member', {
    type: 'service',
    keys: [PERMISSIONS.CONVERSATION_VIEW_ALL, PERMISSIONS.TICKET_VIEW_ALL],
  })
  const actor = await seedPerson('actor', 'admin')
  const requester = await seedPerson('requester', 'user')
  const billing = await seedTeam('Billing', [onTeam.id, former.id])
  const logistics = await seedTeam('Logistics', [elsewhere.id])
  return { billing, logistics, manager, onTeam, elsewhere, solo, former, service, actor, requester }
}

const recipientsOf = (target: HookTarget | null) =>
  [...((target?.target as { principalIds: string[] } | undefined)?.principalIds ?? [])].sort()

const sorted = (...ids: string[]) => [...ids].sort()

function ticketRef(id: TicketId) {
  return { id, number: 1, type: 'customer', priority: 'none', assignedTeamId: null }
}

// ============================================================================
// Ticket watchers
// ============================================================================

describe('ticket watchers hear only about tickets in their scope', () => {
  async function watchedTicket(w: World) {
    const ticket = await seedTicket({ requester: w.requester.id, team: w.billing })
    const id = ticket.id as TicketId
    await testDb.insert(ticketSubscriptions).values(
      [w.requester, w.manager, w.onTeam, w.elsewhere, w.solo, w.former].map((p) => ({
        ticketId: id,
        principalId: p.id,
        reason: p === w.requester ? 'requester' : 'manual',
      }))
    )
    return id
  }

  it('reply bell: in-scope watchers and the requester', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const target = await getTicketRepliedTargets({
      id: 'evt-r',
      type: 'ticket.replied',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: {
        ticket: ticketRef(id),
        messageId: 'conversation_message_1',
        content: 'Fix is queued.',
        attachments: null,
        senderType: 'agent',
        title: 'Cannot log in',
        authorName: 'Sarah',
        requesterPrincipalId: w.requester.id,
      },
    } as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.onTeam.id, w.requester.id))
  })

  it('note bell: in-scope agent watchers only', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const target = await getTicketNoteAddedTargets({
      id: 'evt-n',
      type: 'ticket.note_added',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: { ticket: ticketRef(id), content: 'Internal', title: 'Cannot log in', authorName: 'S' },
    } as unknown as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.onTeam.id))
  })

  it('a watcher hears again once the ticket comes back to their scope', async () => {
    const w = await seedWorld()
    const id = await watchedTicket(w)
    const { tickets } = await import('@/lib/server/db')
    await testDb.update(tickets).set({ assigneeTeamId: w.logistics }).where(eq(tickets.id, id))
    const target = await getTicketNoteAddedTargets({
      id: 'evt-n2',
      type: 'ticket.note_added',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user', principalId: w.actor.id },
      data: { ticket: ticketRef(id), content: 'Internal', title: 'Cannot log in', authorName: 'S' },
    } as unknown as EventData)
    expect(recipientsOf(target)).toEqual(sorted(w.manager.id, w.elsewhere.id))
  })
})
