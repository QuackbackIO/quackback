/**
 * The recipient scope rule, over real rows: a teammate hears about an item only
 * when their own scope holds it, by the same rule the inbox list uses; anyone
 * who is not a current teammate hears only as the item's named requester.
 *
 * Real here: the role tables (custom scoped roles and legacy presets), team
 * memberships, conversations and tickets. The query log checks that a whole
 * team is judged with one permission query, not one per person.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { Logger } from 'drizzle-orm/logger'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import { createId } from '@quackback/ids'
import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { conversations } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  SCOPED_KEYS,
  seedConversation,
  seedPerson,
  seedTeam,
  seedTicket,
  type SeededPerson,
} from '@/lib/server/__tests__/scope-seed'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { inScopeRecipients } from '../recipient-scope'
import {
  teammateTicketView,
  withoutTeammatesWhoCannotSee,
} from '@/lib/server/domains/tickets/ticket-visibility'

const queries: string[] = []
const logger: Logger = { logQuery: (query) => void queries.push(query) }

const fixture = await createDbTestFixture({
  logger,
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  queries.length = 0
})
afterEach(fixture.rollback)
afterAll(fixture.close)

interface World {
  /** Legacy member: the Manager preset, view_all. */
  manager: SeededPerson
  /** Scoped, the item's direct assignee. */
  assignee: SeededPerson
  /** Scoped, a member of the item's team. */
  onTeam: SeededPerson
  /** Scoped, on another team. */
  elsewhere: SeededPerson
  /** Role user: a removed teammate, still named on old rows. */
  former: SeededPerson
  /** Not a teammate, yet holding view_all through a leftover assignment. */
  service: SeededPerson
  /** The customer. */
  requester: SeededPerson
}

async function seedWorld() {
  const manager = await seedPerson('manager', 'member')
  const assignee = await seedPerson('assignee', 'member', { keys: SCOPED_KEYS })
  const onTeam = await seedPerson('on-team', 'member', { keys: SCOPED_KEYS })
  const elsewhere = await seedPerson('elsewhere', 'member', { keys: SCOPED_KEYS })
  const former = await seedPerson('former', 'user')
  const service = await seedPerson('service', 'member', {
    type: 'service',
    keys: [PERMISSIONS.CONVERSATION_VIEW_ALL, PERMISSIONS.TICKET_VIEW_ALL],
  })
  const requester = await seedPerson('requester', 'user')
  const team = await seedTeam('Billing', [onTeam.id, former.id])
  await seedTeam('Logistics', [elsewhere.id])
  const world: World = { manager, assignee, onTeam, elsewhere, former, service, requester }
  return { world, team }
}

const everyone = (w: World) => [
  w.elsewhere.id,
  w.manager.id,
  w.assignee.id,
  w.onTeam.id,
  w.former.id,
  w.service.id,
  w.requester.id,
]

describe('inScopeRecipients for a conversation', () => {
  it('keeps the teammates whose scope holds it, in input order, and drops everyone else', async () => {
    const { world, team } = await seedWorld()
    const { conversation } = await seedConversation({ assignee: world.assignee.id, team })

    const kept = await inScopeRecipients(
      { kind: 'conversation', id: conversation.id as ConversationId },
      everyone(world)
    )

    expect(kept).toEqual([world.manager.id, world.assignee.id, world.onTeam.id])
  })

  it('reads the current row, not what the caller last saw', async () => {
    const { world, team } = await seedWorld()
    const { conversation } = await seedConversation({ assignee: null, team: null })

    const before = await inScopeRecipients(
      { kind: 'conversation', id: conversation.id as ConversationId },
      [world.onTeam.id]
    )
    expect(before).toEqual([])

    const { testDb } = await import('@/lib/server/__tests__/db-test-fixture')
    const { eq } = await import('@/lib/server/db')
    await testDb
      .update(conversations)
      .set({ assignedTeamId: team })
      .where(eq(conversations.id, conversation.id))

    const after = await inScopeRecipients(
      { kind: 'conversation', id: conversation.id as ConversationId },
      [world.onTeam.id]
    )
    expect(after).toEqual([world.onTeam.id])
  })

  it('drops every teammate for a missing conversation', async () => {
    const { world } = await seedWorld()
    const kept = await inScopeRecipients(
      { kind: 'conversation', id: createId('conversation') as ConversationId },
      [world.manager.id]
    )
    expect(kept).toEqual([])
  })

  it('judges a whole team with one permission query and one team query', async () => {
    const { world, team } = await seedWorld()
    const { conversation } = await seedConversation({ assignee: null, team })
    queries.length = 0

    await inScopeRecipients(
      { kind: 'conversation', id: conversation.id as ConversationId },
      everyone(world)
    )

    expect(queries.filter((q) => q.includes('"principal_role_assignments"'))).toHaveLength(1)
    expect(queries.filter((q) => q.includes('"team_members"'))).toHaveLength(1)
  })
})

describe('inScopeRecipients for a ticket', () => {
  it('lets the named requester through, and nobody else who is not a teammate', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team })

    const kept = await inScopeRecipients(
      { kind: 'ticket', id: ticket.id as TicketId },
      everyone(world),
      { requesterPrincipalId: world.requester.id }
    )

    expect(kept).toEqual([world.manager.id, world.onTeam.id, world.requester.id])
  })

  it('drops the named requester of a back-office ticket who is not a teammate', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team, type: 'back_office' })

    const kept = await inScopeRecipients(
      { kind: 'ticket', id: ticket.id as TicketId },
      [world.requester.id, world.onTeam.id],
      { requesterPrincipalId: world.requester.id }
    )

    expect(kept).toEqual([world.onTeam.id])
  })

  it('drops the requester when the caller does not name them', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team })

    const kept = await inScopeRecipients({ kind: 'ticket', id: ticket.id as TicketId }, [
      world.requester.id,
    ])

    expect(kept).toEqual([])
  })

  it('drops every teammate for a deleted ticket, workspace-wide viewers too', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team, deleted: true })

    const kept = await inScopeRecipients({ kind: 'ticket', id: ticket.id as TicketId }, [
      world.manager.id,
      world.onTeam.id,
    ])

    expect(kept).toEqual([])
  })
})

describe('the ticket watcher form (shared with the watchers feature)', () => {
  it('splits teammates by sight, and lets only the named requester through', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team })

    const view = await teammateTicketView(ticket.id as TicketId, everyone(world))
    expect([...view.visible].sort()).toEqual([world.manager.id, world.onTeam.id].sort())
    expect([...view.hidden].sort()).toEqual([world.elsewhere.id, world.assignee.id].sort())

    const input = [world.elsewhere.id, world.requester.id, world.service.id, world.onTeam.id]
    expect(
      await withoutTeammatesWhoCannotSee(ticket.id as TicketId, input as PrincipalId[], {
        requesterPrincipalId: world.requester.id,
      })
    ).toEqual([world.requester.id, world.onTeam.id])
    expect(
      await withoutTeammatesWhoCannotSee(ticket.id as TicketId, input as PrincipalId[])
    ).toEqual([world.onTeam.id])
  })

  it('takes the rows a caller already holds without reading the people again', async () => {
    const { world, team } = await seedWorld()
    const ticket = await seedTicket({ requester: world.requester.id, team })
    queries.length = 0

    const view = await teammateTicketView(ticket.id as TicketId, [
      { id: world.onTeam.id, type: 'user', role: 'member' },
      { id: world.elsewhere.id, type: 'user', role: 'member' },
    ])

    expect([...view.visible]).toEqual([world.onTeam.id])
    expect([...view.hidden]).toEqual([world.elsewhere.id])
    expect(queries.filter((q) => /from "principal"/.test(q))).toHaveLength(0)
  })
})

describe('reading only what is needed', () => {
  it('reads no item when nobody in the input is a teammate', async () => {
    const { world, team } = await seedWorld()
    const { conversation } = await seedConversation({ team })
    queries.length = 0

    await inScopeRecipients({ kind: 'conversation', id: conversation.id as ConversationId }, [
      world.former.id,
      world.requester.id,
    ])

    expect(queries.filter((q) => q.includes('"conversations"'))).toHaveLength(0)
  })

  it('uses the item facts the caller just read instead of reading the row', async () => {
    const { world, team } = await seedWorld()
    const { conversation } = await seedConversation({})
    queries.length = 0

    const kept = await inScopeRecipients(
      {
        kind: 'conversation',
        id: conversation.id as ConversationId,
        facts: { assigneePrincipalId: null, teamId: team },
      },
      [world.onTeam.id, world.elsewhere.id]
    )

    expect(kept).toEqual([world.onTeam.id])
    expect(queries.filter((q) => q.includes('"conversations"'))).toHaveLength(0)
  })
})
