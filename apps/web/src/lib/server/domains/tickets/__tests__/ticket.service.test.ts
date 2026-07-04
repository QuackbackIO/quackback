/**
 * Real-DB coverage for the ticket service (support platform §4.2): create
 * resolves the default status and assigns a number; the close/reopen lifecycle
 * stamps and clears resolvedAt and counts reopens; the first-response stamp is
 * once-only; and assignment is polymorphic with no clearing rule. Runs inside
 * the db-test-fixture rollback transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TeamId, type UserId, type TicketId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { tickets, ticketStatuses, teams, principal, user, settings, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createTicket, setTicketStatus, assignTicket } from '../ticket.service'
import { listTicketMessages } from '../ticket-message.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function adminActor(): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** getStageLabels (invoked by the DTO builder) needs a workspace settings row. */
async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** A deterministic default (open) status + a closed status, all rolled back. */
async function seedStatuses() {
  // Neutralize any committed default so our seeded default is the only one.
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Open',
      slug: `t_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Closed',
      slug: `t_closed_${suffix()}`,
      category: 'closed',
      position: 101,
      isDefault: false,
      publicStage: 'resolved',
    })
    .returning()
  return { open, closed }
}

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

async function readTicket(id: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  return row
}

describe.skipIf(!fixture.available)('ticket.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('createTicket resolves the default status and assigns a number', async () => {
    await seedSettings()
    await seedStatuses()
    const dto = await createTicket({ type: 'customer', title: 'Cannot log in' }, adminActor())

    expect(dto.status.category).toBe('open')
    expect(typeof dto.number).toBe('number')
    expect(dto.number).toBeGreaterThan(0)
    expect(dto.reference).toBe(`#${dto.number}`)
    expect(dto.stage.slot).toBe('received')
    expect(dto.stage.label).toBe('Received')
    expect(dto.resolvedAt).toBeNull()
    expect(dto.reopenedCount).toBe(0)
  })

  it('seeds the description as the opening thread message (agent, filed on behalf)', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const dto = await createTicket(
      { type: 'customer', title: 'Cannot log in', description: 'The login button does nothing' },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].content).toBe('The login button does nothing')
    // Filed by a teammate on someone's behalf -> opens as an agent message.
    expect(page.messages[0].senderType).toBe('agent')
  })

  it('attributes the opening message to the requester when they file it themselves', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const dto = await createTicket(
      {
        type: 'customer',
        title: 'Help',
        description: 'It broke',
        requesterPrincipalId: principalId,
      },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages[0].senderType).toBe('visitor')
  })

  it('seeds no opening message when the description is omitted', async () => {
    await seedSettings()
    await seedStatuses()
    const dto = await createTicket({ type: 'customer', title: 'Quiet ticket' }, adminActor())
    const page = await listTicketMessages(dto.id, {})
    expect(page.messages).toHaveLength(0)
  })

  it('closing stamps resolvedAt + firstResponseAt; reopening clears resolvedAt and counts the reopen', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Billing issue' }, actor)
    const id = created.id

    // Close: enter a closed-category status.
    await setTicketStatus(id, closed.id, actor)
    const afterClose = await readTicket(id)
    expect(afterClose.resolvedAt).not.toBeNull()
    expect(afterClose.reopenedCount).toBe(0)
    // First agent action stamped the first response.
    expect(afterClose.firstResponseAt).not.toBeNull()
    const stampedAt = afterClose.firstResponseAt

    // Reopen: move back out to an open status.
    await setTicketStatus(id, open.id, actor)
    const afterReopen = await readTicket(id)
    expect(afterReopen.resolvedAt).toBeNull()
    expect(afterReopen.reopenedCount).toBe(1)
    // The first-response stamp is once-only, never overwritten on later actions.
    expect(afterReopen.firstResponseAt?.getTime()).toBe(stampedAt?.getTime())
  })

  it('assignment is independent: assigning a team never clears the teammate (no-clear)', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = adminActor()
    const teammate = await seedTeammate()
    const teamId = await seedTeam()
    const created = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const id = created.id

    await assignTicket(id, { assigneePrincipalId: teammate }, actor)
    await assignTicket(id, { assigneeTeamId: teamId }, actor)
    const both = await readTicket(id)
    expect(both.assigneePrincipalId).toBe(teammate)
    expect(both.assigneeTeamId).toBe(teamId)

    // An explicit null clears only that side.
    await assignTicket(id, { assigneePrincipalId: null }, actor)
    const cleared = await readTicket(id)
    expect(cleared.assigneePrincipalId).toBeNull()
    expect(cleared.assigneeTeamId).toBe(teamId)
  })

  it('rejects a non-team-member assignee', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Nope' }, actor)
    // An end-user principal (role 'user') is not assignable.
    const userId = createId('user') as UserId
    const endUser = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'End User' })
    await testDb
      .insert(principal)
      .values({ id: endUser, userId, role: 'user', type: 'user', createdAt: new Date() })

    await expect(assignTicket(created.id, { assigneePrincipalId: endUser }, actor)).rejects.toThrow(
      /team member/i
    )
  })
})
