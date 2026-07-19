/**
 * Real-DB coverage for the ticket activity log: the record/list roundtrip
 * (newest-first, actor-name resolution, System rows), and every instrumented
 * writer in ticket.service — created, status_changed (including the
 * customer-silent internal churn), assigned (principal + team, with the
 * no-op gate), priority_changed, the requester-reply reopen, and soft delete.
 * Runs inside the db-test-fixture rollback transaction.
 *
 * Every actor here is backed by a real principal row: activity inserts carry
 * an FK to principal, and a failing statement would abort the fixture's
 * transaction (which is also why suites using unbacked actors mock this
 * service instead).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId, type TicketId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  ticketActivity,
  teams,
  principal,
  user,
  settings,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize the fire-and-forget webhook bridge and the Redis-backed realtime
// publish (same convention as ticket.service.test.ts).
const webhooks = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => webhooks)
const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// config getters validate the full env (absent in tests).
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { recordTicketActivity, listTicketActivity } from '../ticket-activity.service'
import {
  createTicket,
  setTicketStatus,
  assignTicket,
  setTicketPriority,
  softDeleteTicket,
  autoReopenOnRequesterReply,
} from '../ticket.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketActivity.id }).from(ticketActivity).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(name?: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const displayName = name ?? `Agent-${suffix()}`
  await testDb.insert(user).values({ id: userId, name: displayName })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'member',
    type: 'user',
    displayName,
    createdAt: new Date(),
  })
  return principalId
}

/** An admin actor backed by a real principal row (activity FK-safe). */
async function backedAdminActor(name?: string): Promise<Actor> {
  return {
    principalId: await seedTeammate(name),
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** Default open + closed statuses, plus an awaiting-requester pending one. */
async function seedStatuses() {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'A-Open',
      slug: `a_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'A-Closed',
      slug: `a_closed_${suffix()}`,
      category: 'closed',
      position: 102,
      publicStage: 'resolved',
    })
    .returning()
  const [waiting] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'A-Waiting',
      slug: `a_waiting_${suffix()}`,
      category: 'pending',
      position: 101,
      publicStage: 'awaiting_requester',
    })
    .returning()
  return { open, closed, waiting }
}

/** Raw activity rows for a ticket (oldest first, as inserted). */
async function rawActivity(ticketId: TicketId) {
  return testDb
    .select()
    .from(ticketActivity)
    .where(eq(ticketActivity.ticketId, ticketId))
    .orderBy(ticketActivity.id)
}

describe.skipIf(!fixture.available)('ticket-activity.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => Object.values(webhooks).forEach((m) => m.mockClear()))
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('record + list roundtrip', () => {
    it('lists newest-first with actor names resolved; a null principal reads as system', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor('Riley Agent')
      const created = await createTicket({ type: 'customer', title: 'Roundtrip' }, actor)

      recordTicketActivity({
        ticketId: created.id,
        principalId: actor.principalId,
        type: 'priority.changed',
        metadata: { from: 'none', to: 'high' },
      })
      recordTicketActivity({
        ticketId: created.id,
        principalId: null,
        type: 'ticket.reopened',
        metadata: { trigger: 'requester_reply' },
      })

      const rows = await listTicketActivity(created.id)
      // createTicket itself wrote 'ticket.created' first; newest-first order.
      expect(rows.map((r) => r.type)).toEqual([
        'ticket.reopened',
        'priority.changed',
        'ticket.created',
      ])
      expect(rows[1].actorName).toBe('Riley Agent')
      expect(rows[1].metadata).toEqual({ from: 'none', to: 'high' })
      expect(rows[0].principalId).toBeNull()
      expect(rows[0].actorName).toBeNull()
    })
  })

  describe('writers', () => {
    it('createTicket records ticket.created with the actor + ticket type', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'back_office', title: 'Log me' }, actor)

      const rows = await rawActivity(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].type).toBe('ticket.created')
      expect(rows[0].principalId).toBe(actor.principalId)
      expect(rows[0].metadata).toEqual({ ticketType: 'back_office' })
    })

    it('setTicketStatus records status.changed with from/to ids + names', async () => {
      await seedSettings()
      const { open, closed } = await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'customer', title: 'Move me' }, actor)

      await setTicketStatus(created.id, closed.id, actor)

      const rows = await rawActivity(created.id)
      const move = rows.find((r) => r.type === 'status.changed')
      expect(move).toBeDefined()
      expect(move?.principalId).toBe(actor.principalId)
      expect(move?.metadata).toEqual({
        fromId: open.id,
        fromName: 'A-Open',
        toId: closed.id,
        toName: 'A-Closed',
      })
    })

    it('records internal churn the customer-facing stage event stays silent on', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      // A second open status projecting the SAME public stage (silent branch).
      const [sameStage] = await testDb
        .insert(ticketStatuses)
        .values({
          name: 'A-Triaging',
          slug: `a_tri_${suffix()}`,
          category: 'open',
          position: 103,
          publicStage: 'received',
        })
        .returning()
      const created = await createTicket({ type: 'customer', title: 'Quiet move' }, actor)

      await setTicketStatus(created.id, sameStage.id, actor)

      const rows = await rawActivity(created.id)
      const move = rows.find((r) => r.type === 'status.changed')
      expect(move).toBeDefined()
      expect((move?.metadata as { toName?: string }).toName).toBe('A-Triaging')
    })

    it('a same-status set records nothing', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'customer', title: 'No-op' }, actor)

      await setTicketStatus(created.id, open.id, actor)

      const rows = await rawActivity(created.id)
      expect(rows.filter((r) => r.type === 'status.changed')).toHaveLength(0)
    })

    it('assignTicket records ticket.assigned with principal from/to (ids + names)', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor('Casey Creator')
      const teammate = await seedTeammate('Jordan Assignee')
      // Agent-created tickets are born assigned to their creator, so the first
      // explicit assignment is a real from -> to move.
      const created = await createTicket({ type: 'back_office', title: 'Assign me' }, actor)

      await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)

      const rows = await rawActivity(created.id)
      const assigned = rows.find((r) => r.type === 'ticket.assigned')
      expect(assigned).toBeDefined()
      expect(assigned?.principalId).toBe(actor.principalId)
      expect(assigned?.metadata).toEqual({
        fromPrincipalId: actor.principalId,
        fromPrincipalName: 'Casey Creator',
        toPrincipalId: teammate,
        toPrincipalName: 'Jordan Assignee',
      })
    })

    it('assignTicket records a team move with from/to team ids + names', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const [team] = await testDb.insert(teams).values({ name: 'Payments Squad' }).returning()
      const created = await createTicket({ type: 'back_office', title: 'Team me' }, actor)

      await assignTicket(created.id, { assigneeTeamId: team.id }, actor)

      const rows = await rawActivity(created.id)
      const assigned = rows.find((r) => r.type === 'ticket.assigned')
      expect(assigned?.metadata).toEqual({
        fromTeamId: null,
        fromTeamName: null,
        toTeamId: team.id,
        toTeamName: 'Payments Squad',
      })
    })

    it('a no-op re-assign records nothing', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const teammate = await seedTeammate()
      const created = await createTicket({ type: 'back_office', title: 'Re-assign' }, actor)

      await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)
      await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)

      const rows = await rawActivity(created.id)
      expect(rows.filter((r) => r.type === 'ticket.assigned')).toHaveLength(1)
    })

    it('setTicketPriority records priority.changed; a no-op re-set records nothing', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'customer', title: 'Prioritize' }, actor)

      await setTicketPriority(created.id, 'urgent', actor)
      await setTicketPriority(created.id, 'urgent', actor)

      const rows = await rawActivity(created.id)
      const changes = rows.filter((r) => r.type === 'priority.changed')
      expect(changes).toHaveLength(1)
      expect(changes[0].metadata).toEqual({ from: 'none', to: 'urgent' })
      expect(changes[0].principalId).toBe(actor.principalId)
    })

    it('autoReopenOnRequesterReply records a distinct ticket.reopened event', async () => {
      await seedSettings()
      const { waiting } = await seedStatuses()
      const actor = await backedAdminActor()
      const requester = await seedTeammate('Casey Requester')
      const created = await createTicket(
        { type: 'customer', title: 'Reopen me', requesterPrincipalId: requester },
        actor
      )
      await setTicketStatus(created.id, waiting.id, actor)

      const moved = await autoReopenOnRequesterReply(created.id, requester)
      expect(moved).toBe(true)

      // The reopen target is the FIRST open status by position — committed
      // seed statuses (e.g. "New") can outrank this suite's own, so read the
      // ticket's actual landing status rather than assuming ours won.
      const [after] = await testDb
        .select({ statusId: tickets.statusId })
        .from(tickets)
        .where(eq(tickets.id, created.id))
      const [landed] = await testDb
        .select({ name: ticketStatuses.name })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.id, after.statusId))

      const rows = await rawActivity(created.id)
      const reopened = rows.find((r) => r.type === 'ticket.reopened')
      expect(reopened).toBeDefined()
      expect(reopened?.principalId).toBe(requester)
      expect(reopened?.metadata).toEqual({
        fromId: waiting.id,
        fromName: 'A-Waiting',
        toId: after.statusId,
        toName: landed.name,
        trigger: 'requester_reply',
      })
    })

    it('an auto-reopen that does not move records nothing', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'customer', title: 'Already open' }, actor)

      const moved = await autoReopenOnRequesterReply(created.id, actor.principalId)
      expect(moved).toBe(false)

      const rows = await rawActivity(created.id)
      expect(rows.filter((r) => r.type === 'ticket.reopened')).toHaveLength(0)
    })

    it('softDeleteTicket records ticket.deleted', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await backedAdminActor()
      const created = await createTicket({ type: 'customer', title: 'Delete me' }, actor)

      await softDeleteTicket(created.id, actor)

      const rows = await rawActivity(created.id)
      expect(rows.map((r) => r.type)).toContain('ticket.deleted')
    })
  })
})
