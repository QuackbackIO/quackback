import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  user,
  conversations,
  conversationParticipants,
  channelIdentities,
  and,
  eq,
  inArray,
} from '@/lib/server/db'
import { contactRecipientFrom } from '@/lib/server/email/recipient'

const sendEmail = vi.hoisted(() =>
  vi.fn<(options: Record<string, unknown>) => Promise<{ sent: boolean }>>()
)

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: async () => false,
  isPrincipalOnline: async (id: PrincipalId) => {
    expect(id).toBeDefined()
    return false
  },
}))
vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.example.com',
    logoUrl: null,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => false,
}))
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  sendConversationMessageEmail: sendEmail,
}))

import {
  notifyVisitorMessage,
  notifyAgentReply,
  notifyConversationStarted,
  sendVisitorConversationEmail,
} from '../conversation.notify'
import { getOrCreateTestCustomer } from '@/lib/server/test-customer'

const fixture = await createDbTestFixture()
let owner: PrincipalId, other: PrincipalId, contactOnly: PrincipalId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  sendEmail.mockReset().mockResolvedValue({ sent: true })
  owner = createId('principal')
  other = createId('principal')
  contactOnly = createId('principal')
  const ownerUser = createId('user'),
    otherUser = createId('user')
  await testDb.insert(user).values([
    { id: ownerUser, name: 'Acme', email: 'you@example.com' },
    { id: otherUser, name: 'Acme', email: 'other@example.com' },
  ])
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: other, userId: otherUser, type: 'user', role: 'member', createdAt: new Date() },
    {
      id: contactOnly,
      type: 'user',
      role: 'member',
      contactEmail: 'contact@example.com',
      createdAt: new Date(),
    },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function send(attributes: Record<string, unknown>) {
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: customer.id,
      channel: 'messenger',
      customAttributes: attributes,
    })
    .returning()
  await notifyVisitorMessage({
    conversation,
    content: 'Hello',
    authorName: customer.displayName!,
    isFirstMessage: true,
  })
}

function recipients() {
  return sendEmail.mock.calls.map(([options]) => options.to).sort()
}

it.each([{}, { test: 'false' }])(
  'emails only the owner for a test customer thread with attributes %j',
  async (attributes) => {
    await send(attributes)
    expect(recipients()).toEqual(['you@example.com'])
  }
)

it('keeps every ordinary team recipient, including a contact-only teammate', async () => {
  const [visitor] = await testDb
    .insert(principal)
    .values({
      type: 'anonymous',
      role: 'user',
      createdAt: new Date(),
    })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor.id,
      channel: 'messenger',
      customAttributes: {},
    })
    .returning()
  const team = await testDb
    .select({
      accountEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))
  const expected = team
    .flatMap((person) => {
      const email = contactRecipientFrom(person)
      return email ? [email] : []
    })
    .sort()
  await notifyVisitorMessage({
    conversation,
    content: 'Hello',
    authorName: 'Acme',
    isFirstMessage: true,
  })
  expect(expected).toContain('you@example.com')
  expect(expected).toContain('other@example.com')
  expect(expected).toContain('contact@example.com')
  expect(recipients()).toEqual(expected)
})

async function replyThread(test: boolean | string | undefined, testCustomer = true) {
  const visitor = testCustomer
    ? await getOrCreateTestCustomer(owner, 'en')
    : (await testDb.select().from(principal).where(eq(principal.id, other)))[0]
  // A visitor-controlled address must never redirect a test notification.
  await testDb
    .update(principal)
    .set({ contactEmail: 'other@example.com' })
    .where(eq(principal.id, visitor.id))
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor.id,
      channel: 'email',
      customAttributes: test === undefined ? {} : { test, testOwnerPrincipalId: owner },
    })
    .returning()
  await testDb.insert(conversationParticipants).values({
    conversationId: conversation.id,
    principalId: contactOnly,
    addedByPrincipalId: owner,
  })
  return conversation
}

it.each([true, 'true', undefined])(
  'limits test replies and participant fan-out to the stored owner whatever the attributes (%s)',
  async (test) => {
    const conversation = await replyThread(test)
    await notifyAgentReply({
      conversationId: conversation.id,
      visitorPrincipalId: conversation.visitorPrincipalId,
      capturedEmail: 'contact@example.com',
      content: 'Acme reply',
      agentName: 'Acme',
      channel: 'email',
    })
    expect(recipients()).toEqual(['you@example.com'])
    expect(
      await testDb
        .select({ externalId: channelIdentities.externalId })
        .from(channelIdentities)
        .where(eq(channelIdentities.principalId, conversation.visitorPrincipalId))
    ).toEqual([])
  }
)

it.each([undefined, true])(
  'keeps ordinary group reply recipients (legacy marker %s)',
  async (test) => {
    const conversation = await replyThread(test, false)
    await notifyAgentReply({
      conversationId: conversation.id,
      visitorPrincipalId: conversation.visitorPrincipalId,
      content: 'Acme reply',
      agentName: 'Acme',
      channel: 'email',
    })
    expect(recipients()).toEqual(['contact@example.com', 'other@example.com'])
  }
)

it('does not deliver a test reply after the owner loses their team role', async () => {
  const conversation = await replyThread(true)
  await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
  await notifyAgentReply({
    conversationId: conversation.id,
    visitorPrincipalId: conversation.visitorPrincipalId,
    content: 'Acme reply',
    agentName: 'Acme',
    channel: 'email',
  })
  expect(recipients()).toEqual([])
})

it('limits an agent-started test conversation to the stored owner', async () => {
  const conversation = await replyThread(true)
  await notifyConversationStarted({
    conversationId: conversation.id,
    visitorPrincipalId: conversation.visitorPrincipalId,
    content: 'Acme reply',
    agentName: 'Acme',
  })
  expect(recipients()).toEqual(['you@example.com'])
})

it('rejects a direct test email addressed to someone other than its owner', async () => {
  const conversation = await replyThread(true)
  await sendVisitorConversationEmail({
    conversationId: conversation.id,
    visitorPrincipalId: conversation.visitorPrincipalId,
    recipient: 'contact@example.com',
    direction: 'agent_reply',
    senderName: 'Acme',
    content: 'Acme reply',
    ctaUrl: 'https://acme.example.com',
    ctx: { workspaceName: 'Acme', logoUrl: null },
    channel: 'email',
  })
  expect(recipients()).toEqual([])
})
