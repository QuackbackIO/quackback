import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TicketId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  user,
  principal,
  tickets,
  ticketStatuses,
  ticketConversations,
  conversations,
  conversationMessages,
  settings,
  eq,
  and,
  notTestTicket,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { linkTicketToConversation } from '../ticket-conversation-link.service'

const fixture = await createDbTestFixture()
let owner: PrincipalId, ordinary: PrincipalId, customer: PrincipalId
let actor: Actor
let statusId: typeof ticketStatuses.$inferSelect.id

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:_\w+)?(?:\?|$)/)
  await fixture.begin()
  const ownerUser = createId('user')
  owner = createId('principal')
  ordinary = createId('principal')
  customer = createId('principal')
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
  actor = {
    principalId: owner,
    principalType: 'user',
    role: 'admin',
    permissions: new Set([PERMISSIONS.TICKET_CREATE]),
    segmentIds: new Set(),
  }
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme open', slug: createId('ticket_status') })
    .returning()
  statusId = status.id
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('workspace')}`, createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function seed(kind: 'real' | 'marker' | 'identity') {
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      type: 'back_office',
      title: 'Acme request',
      statusId,
      requesterPrincipalId: kind === 'identity' ? customer : ordinary,
      customAttributes: kind === 'marker' ? { test: true, testOwnerPrincipalId: owner } : {},
    })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: kind === 'identity' ? customer : ordinary,
      channel: 'messenger',
      customAttributes: kind === 'marker' ? { test: true, testOwnerPrincipalId: owner } : {},
    })
    .returning()
  return { ticket, conversation }
}

async function realTicketCount(id: TicketId) {
  return (
    await testDb
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, id), notTestTicket(tickets.id)))
  ).length
}

it.each(['identity'] as const)(
  'rejects linking a %s conversation into a real ticket before writing a link or announcement',
  async (kind) => {
    const { ticket } = await seed('real')
    const { conversation } = await seed(kind)
    expect(await realTicketCount(ticket.id)).toBe(1)
    await expect(linkTicketToConversation(ticket.id, conversation.id, actor)).rejects.toMatchObject(
      { code: 'TEST_DATA_LINK_CONFLICT' }
    )
    expect(
      await testDb.query.ticketConversations.findFirst({
        where: eq(ticketConversations.ticketId, ticket.id),
      })
    ).toBeUndefined()
    expect(
      await testDb.query.conversationMessages.findFirst({
        where: eq(conversationMessages.conversationId, conversation.id),
      })
    ).toBeUndefined()
    expect(await realTicketCount(ticket.id)).toBe(1)
  }
)

it.each(['identity'] as const)(
  'rejects linking a real conversation into a %s ticket',
  async (kind) => {
    const { ticket } = await seed(kind)
    const { conversation } = await seed('real')
    await expect(linkTicketToConversation(ticket.id, conversation.id, actor)).rejects.toMatchObject(
      { code: 'TEST_DATA_LINK_CONFLICT' }
    )
    expect(
      await testDb.query.ticketConversations.findFirst({
        where: eq(ticketConversations.ticketId, ticket.id),
      })
    ).toBeUndefined()
    expect(
      await testDb.query.conversationMessages.findFirst({
        where: eq(conversationMessages.conversationId, conversation.id),
      })
    ).toBeUndefined()
  }
)

it.each(['real', 'marker', 'identity'] as const)(
  'permits %s conversations and tickets with matching provenance',
  async (kind) => {
    const { ticket, conversation } = await seed(kind)
    await linkTicketToConversation(ticket.id, conversation.id, actor)
    expect(
      await testDb.query.ticketConversations.findFirst({
        where: and(
          eq(ticketConversations.ticketId, ticket.id),
          eq(ticketConversations.conversationId, conversation.id)
        ),
      })
    ).toBeDefined()
    // A legacy client marker is real data: only the test customer's identity is test.
    expect(await realTicketCount(ticket.id)).toBe(kind === 'identity' ? 0 : 1)
  }
)

it('uses an existing linked test conversation when classifying an otherwise unmarked ticket', async () => {
  const { ticket, conversation: realConversation } = await seed('real')
  const { conversation: testConversation } = await seed('identity')
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticket.id, conversationId: testConversation.id, ticketType: 'back_office' })
  await expect(
    linkTicketToConversation(ticket.id, realConversation.id, actor)
  ).rejects.toMatchObject({ code: 'TEST_DATA_LINK_CONFLICT' })
  const links = await testDb
    .select()
    .from(ticketConversations)
    .where(eq(ticketConversations.ticketId, ticket.id))
  expect(links.map((link) => link.conversationId)).toEqual([testConversation.id])
})
