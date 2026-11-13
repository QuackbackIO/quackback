/**
 * Real-DB coverage for how a workflow or macro action finds a conversation's
 * paired ticket. The lookup is a system read, so it finds the pair even when
 * the action runs as a scoped teammate who cannot see that ticket: a macro's
 * `convert_to_ticket` reports "already a ticket" and files no second one.
 *
 * Real here: the executor, the pair lookup and the rows. Stood in for:
 * realtime and the webhook bridges.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  eq,
  principal,
  teamMembers,
  teams,
  ticketConversations,
  tickets,
  ticketStatuses,
  user,
  PERMISSIONS,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { applyAction } from '../action.executor'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `P-${suffix()}`, email: `p-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

describe('the paired ticket lookup in workflow and macro actions (real DB, rolled back)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("a scoped teammate's convert_to_ticket finds a pair it cannot see and files nothing", async () => {
    const teammate = await seedPerson('member')
    const visitor = await seedPerson('user')
    const teamX = createId('team') as TeamId
    const teamY = createId('team') as TeamId
    await testDb.insert(teams).values([
      { id: teamX, name: `X-${suffix()}` },
      { id: teamY, name: `Y-${suffix()}` },
    ])
    await testDb.insert(teamMembers).values({ teamId: teamX, principalId: teammate })
    const statusId = createId('ticket_status') as TicketStatusId
    await testDb
      .insert(ticketStatuses)
      .values({ id: statusId, name: 'Acme open', slug: `lt-${suffix()}`, isDefault: true })

    // My team's conversation; its paired ticket sits on another team.
    const conversationId = createId('conversation') as ConversationId
    await testDb.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedTeamId: teamX,
    })
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({
      id: ticketId,
      title: 'Acme cannot sign in',
      statusId,
      type: 'customer',
      assigneeTeamId: teamY,
      requesterPrincipalId: visitor,
    })
    await testDb
      .insert(ticketConversations)
      .values({ ticketId, conversationId, ticketType: 'customer' })

    const actor: Actor = {
      principalId: teammate,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([
        PERMISSIONS.TICKET_VIEW,
        PERMISSIONS.TICKET_CREATE,
        PERMISSIONS.CONVERSATION_VIEW,
        PERMISSIONS.CONVERSATION_REPLY,
      ]),
    }
    const result = await applyAction({ type: 'convert_to_ticket' }, { conversationId, actor })
    expect(result).toMatchObject({ label: 'already a ticket' })
    const forRequester = await testDb
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.requesterPrincipalId, visitor))
    expect(forRequester).toEqual([{ id: ticketId }])
  })
})
