import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  user,
  principal,
  boards,
  posts,
  postComments,
  conversations,
  conversationMessages,
  tickets,
  ticketStatuses,
  ticketConversations,
  integrations,
  integrationSyncOperations,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { installationIdentity } from '../identity'
import { syncSourceForActor, validateSyncSource, canDispatchSync } from '../eligibility'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture()
let owner: PrincipalId, customer: PrincipalId, ordinary: PrincipalId
let actor: Actor
let integration: typeof integrations.$inferSelect
let ids: Record<string, string>

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:_\w+)?(?:\?|$)/)
  await fixture.begin()
  const ownerUser = createId('user'),
    ordinaryUser = createId('user'),
    customerUser = createId('user')
  owner = createId('principal')
  ordinary = createId('principal')
  customer = createId('principal')
  await testDb.insert(user).values([
    { id: ownerUser, name: 'Acme', email: `you+${ownerUser}@example.com` },
    { id: ordinaryUser, name: 'Acme user', email: `you+${ordinaryUser}@example.com` },
    { id: customerUser, name: 'Test customer', isAnonymous: true },
  ])
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: ordinary, userId: ordinaryUser, type: 'user', role: 'user', createdAt: new Date() },
  ])
  await testDb.insert(principal).values({
    id: customer,
    userId: customerUser,
    type: 'anonymous',
    role: 'user',
    testOwnerPrincipalId: owner,
    createdAt: new Date(),
  })
  actor = {
    principalId: owner,
    principalType: 'user',
    role: 'admin',
    segmentIds: new Set(),
    permissions: new Set([
      PERMISSIONS.POST_VIEW_PRIVATE,
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.CONVERSATION_VIEW_ALL,
      PERMISSIONS.INTEGRATION_MANAGE,
    ]),
  }
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Acme', slug: createId('board') })
    .returning()
  const [realPost, markedPost, identityPost] = await testDb
    .insert(posts)
    .values([
      { boardId: board.id, title: 'Acme real idea', content: '', principalId: ordinary },
      {
        boardId: board.id,
        title: 'Acme marked idea',
        content: '',
        principalId: ordinary,
        widgetMetadata: { test: 'true' },
      },
      { boardId: board.id, title: 'Acme test identity idea', content: '', principalId: customer },
    ])
    .returning()
  const [realComment, markedPostComment, identityComment] = await testDb
    .insert(postComments)
    .values([
      { postId: realPost.id, principalId: ordinary, content: 'Acme real comment' },
      { postId: markedPost.id, principalId: ordinary, content: 'Acme test post comment' },
      { postId: realPost.id, principalId: customer, content: 'Acme test identity comment' },
    ])
    .returning()
  const [realConversation, markedConversation, identityConversation] = await testDb
    .insert(conversations)
    .values([
      { visitorPrincipalId: ordinary, channel: 'messenger' },
      { visitorPrincipalId: owner, channel: 'messenger', customAttributes: { test: true } },
      { visitorPrincipalId: customer, channel: 'messenger' },
    ])
    .returning()
  const [realMessage, markedMessage, identityMessage] = await testDb
    .insert(conversationMessages)
    .values([
      {
        conversationId: realConversation.id,
        principalId: ordinary,
        senderType: 'visitor',
        content: 'Acme real message',
      },
      {
        conversationId: markedConversation.id,
        principalId: owner,
        senderType: 'visitor',
        content: 'Acme test conversation message',
      },
      {
        conversationId: realConversation.id,
        principalId: customer,
        senderType: 'visitor',
        content: 'Acme test identity message',
      },
    ])
    .returning()
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme open', slug: createId('ticket_status') })
    .returning()
  const [realTicket, markedTicket, identityTicket, linkedTicket] = await testDb
    .insert(tickets)
    .values([
      { title: 'Acme real request', statusId: status.id, requesterPrincipalId: ordinary },
      {
        title: 'Acme marked request',
        statusId: status.id,
        requesterPrincipalId: ordinary,
        customAttributes: { test: 'true' },
      },
      { title: 'Acme test identity request', statusId: status.id, requesterPrincipalId: customer },
      { title: 'Acme linked test request', statusId: status.id, requesterPrincipalId: ordinary },
    ])
    .returning()
  await testDb.insert(ticketConversations).values({
    ticketId: linkedTicket.id,
    conversationId: identityConversation.id,
    ticketType: 'customer',
  })
  ;[integration] = await testDb
    .insert(integrations)
    .values({ integrationType: 'slack', status: 'active', config: { channelId: 'ACME' } })
    .returning()
  ids = {
    realPost: realPost.id,
    markedPost: markedPost.id,
    identityPost: identityPost.id,
    realComment: realComment.id,
    markedPostComment: markedPostComment.id,
    identityComment: identityComment.id,
    realConversation: realConversation.id,
    markedConversation: markedConversation.id,
    identityConversation: identityConversation.id,
    realMessage: realMessage.id,
    markedMessage: markedMessage.id,
    identityMessage: identityMessage.id,
    realTicket: realTicket.id,
    markedTicket: markedTicket.id,
    identityTicket: identityTicket.id,
    linkedTicket: linkedTicket.id,
    realUser: ordinaryUser,
    testUser: customerUser,
  }
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function operation(
  sourceType: string,
  sourceId: string,
  kind = 'create',
  requestedBy: PrincipalId | null = owner
) {
  const [row] = await testDb
    .insert(integrationSyncOperations)
    .values({
      operationKey: crypto.randomUUID(),
      integrationId: integration.id,
      installation: installationIdentity(integration),
      provider: 'slack',
      direction: 'outbound',
      kind,
      sourceType,
      sourceId,
      requestedBy,
      destination: { channelId: 'ACME' },
      destinationKey: 'ACME',
    })
    .returning()
  return row
}

async function denied(sourceType: string, sourceId: string, kind = 'create') {
  expect(await syncSourceForActor({ sourceType, sourceId, kind }, actor)).toBeNull()
  for (const requestedBy of [owner, null]) {
    const row = await operation(sourceType, sourceId, kind, requestedBy)
    expect(await validateSyncSource(row)).toEqual({
      state: 'cancelled',
      errorCode: 'source_unavailable',
    })
    expect(await canDispatchSync(row, integration)).toBe(false)
  }
}
async function allowed(sourceType: string, sourceId: string) {
  expect(await syncSourceForActor({ sourceType, sourceId }, actor)).not.toBeNull()
  const row = await operation(sourceType, sourceId)
  expect(await validateSyncSource(row)).toBeNull()
  expect(await canDispatchSync(row, integration)).toBe(true)
}

it('blocks manual sync of test posts and comments while permitting real source dispatch', async () => {
  await allowed('post', ids.realPost)
  await allowed('comment', ids.realComment)
  // A legacy client marker is real data; only the test customer's identity is test.
  await allowed('post', ids.markedPost)
  await allowed('comment', ids.markedPostComment)
  await denied('post', ids.identityPost)
  await denied('comment', ids.identityComment)
})
it('blocks manual sync of test conversations and messages while permitting real source dispatch', async () => {
  await allowed('conversation', ids.realConversation)
  await allowed('message', ids.realMessage)
  await allowed('conversation', ids.markedConversation)
  await allowed('message', ids.markedMessage)
  await denied('conversation', ids.identityConversation)
  await denied('message', ids.identityMessage)
})
it('blocks test ticket issue creation by requester and linked thread before archive bypass', async () => {
  await allowed('ticket', ids.realTicket)
  await allowed('ticket', ids.markedTicket)
  for (const id of [ids.identityTicket, ids.linkedTicket]) {
    await denied('ticket', id)
    await denied('ticket', id, 'archive')
  }
})
it('blocks external sync of the test customer identity and permits a real user', async () => {
  await allowed('user', ids.realUser)
  await denied('user', ids.testUser)
})
