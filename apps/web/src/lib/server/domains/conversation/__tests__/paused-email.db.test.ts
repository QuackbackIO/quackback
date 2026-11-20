/**
 * "Pause all email" for customers.
 *
 * A customer who paused all email gets no automated email on an email
 * conversation: no closing notice, no rating request and no automatic
 * acknowledgement. A teammate's reply still reaches them: it is the
 * conversation, not a notification.
 *
 * Real database (rolled back per test). The email package is the double: each
 * sender records who it was asked to mail.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

process.env.BASE_URL ||= 'https://acme.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

const sent = vi.hoisted(() => [] as Array<{ kind: string; to: string }>)
vi.mock('@quackback/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/email')>()
  const record = (kind: string) => async (opts: { to: string }) => {
    sent.push({ kind, to: opts.to })
    return { sent: true }
  }
  return {
    ...actual,
    sendConversationClosedEmail: record('closed'),
    sendCsatRequestEmail: record('csat'),
    sendConversationAutoAckEmail: record('auto_ack'),
    sendConversationMessageEmail: record('reply'),
  }
})

// Rating links are signed with the server secret, which this suite has no
// need for: any token will do.
vi.mock('@/lib/server/domains/conversation/csat-email-token', () => ({
  mintCsatEmailToken: () => 'csat-token',
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  isPrincipalOnline: async () => false,
  readAvailableAgentIds: async () => [],
}))
vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => true,
  isSupportTicketsEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/settings/settings.email-auto-ack', () => ({
  getEmailAutoAck: async () => ({ enabled: true }),
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  requireSettings: async () => ({ name: 'Acme' }),
}))
// A real bucket keyed on the sender address would burn a shared hourly budget
// across repeated local runs; its arithmetic is pinned in its own suite.
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: async () => ({ count: 1 }),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, notificationPreferences, principal, user } from '@/lib/server/db'
import type { ParsedInboundEmail } from '@/lib/server/domains/conversation/conversation.email-inbound'
import { notifyConversationClosed } from '@/lib/server/domains/conversation/conversation.notify-closed'
import {
  notifyAgentReply,
  notifyCsatRequestEmail,
} from '@/lib/server/domains/conversation/conversation.notify'
import { maybeSendColdInboundAck } from '@/lib/server/domains/conversation/conversation.auto-ack'

const fixture = await createDbTestFixture()

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedCustomer(opts: {
  paused: boolean
}): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `customer-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'user', type: 'user', createdAt: new Date() })
  if (opts.paused) {
    await testDb.insert(notificationPreferences).values({ principalId: id, emailMuted: true })
  }
  return { id, email }
}

async function seedEmailConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'email', subject: 'Export' })
  return id
}

function inbound(from: string): ParsedInboundEmail {
  return {
    from,
    toAddresses: ['support@acme.test'],
    ccAddresses: [],
    replyToAddresses: [],
    subject: 'Export',
    text: 'Hi',
    html: undefined,
    messageId: `in-${suffix()}@example.com`,
    emailId: null,
    inReplyTo: null,
    references: [],
    autoSubmitted: null,
    autoResponseSuppress: null,
    precedence: null,
    hasListHeaders: false,
    authenticationResults: null,
  }
}

const automated: Array<
  [string, (c: { id: PrincipalId; email: string }, id: ConversationId) => Promise<unknown>]
> = [
  [
    'closing notice',
    (_c, id) => notifyConversationClosed({ conversationId: id, variant: 'closed' }),
  ],
  ['rating request', (_c, id) => notifyCsatRequestEmail(id, 'How did we do?')],
  [
    'automatic acknowledgement',
    (c, id) =>
      maybeSendColdInboundAck({
        parsed: inbound(c.email),
        conversationId: id,
        conversationSubject: 'Export',
        senderPrincipalId: c.id,
      }),
  ],
]

describe.skipIf(!fixture.available)('"Pause all email" for customers', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    sent.length = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it.each(automated)('holds back the %s', async (_name, send) => {
    const customer = await seedCustomer({ paused: true })
    await send(customer, await seedEmailConversation(customer.id))
    expect(sent).toEqual([])
  })

  it.each(automated)('sends the %s when email is not paused', async (_name, send) => {
    const customer = await seedCustomer({ paused: false })
    await send(customer, await seedEmailConversation(customer.id))
    expect(sent.map((s) => s.to)).toEqual([customer.email])
  })

  it("still sends a teammate's reply", async () => {
    const customer = await seedCustomer({ paused: true })
    const conversationId = await seedEmailConversation(customer.id)
    await notifyAgentReply({
      conversationId,
      visitorPrincipalId: customer.id,
      content: 'Here is the fix.',
      agentName: 'Sam',
      channel: 'email',
    })
    expect(sent).toEqual([{ kind: 'reply', to: customer.email }])
  })
})
