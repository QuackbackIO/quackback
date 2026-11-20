/**
 * The quiet half of spam auto-filing (journey INB-62), real DB, rolled back:
 * a cold inbound email that a deterministic spam rule files into Spam must not
 * ring the team's new-message bell.
 *
 * The bell is decided at worker time: ingest writes `message.created` to the
 * event outbox, and the event-dispatch job later resolves its notification
 * targets. This file runs that resolution after ingest returns (so after the
 * filing, as a worker would), with the real outbox rows and the real
 * notification resolver. A legitimate email is the positive control: the same
 * resolution bells the teammate who can see the thread.
 *
 * Cold inbound email never sends the team's new-message email
 * (notifyVisitorMessage is called by the messenger send path only), so the
 * bell is the team notification this path can raise.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type TeamId } from '@quackback/ids'
import type { UserId } from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  events,
  principal,
  settings,
  user,
  and,
  eq,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Live inbox pushes need runtime config; the outbox events are what this file
// is about, so the emits stay real.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))
vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn().mockResolvedValue({ count: 1 }),
  incrementBuckets: vi.fn().mockResolvedValue([1]),
  bucketRetryAfter: vi.fn().mockResolvedValue(60),
}))
// The legitimate control reaches the AI classifier; it answers "not spam".
// The spam case is filed by a header rule before any classification.
const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))
vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: () => true,
  structuredOutputProviderOptions: () => ({}),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-classify-model',
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: vi.fn().mockResolvedValue(undefined),
}))

import { ingestParsedEmail } from '../conversation.email-inbound.service'
import { hydrateEvent } from '@/lib/server/events/outbox'
import { notificationResolver } from '@/lib/server/events/resolvers/notification.resolver'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: events.id }).from(events).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** One workspace with an inbound address and one admin who sees every thread. */
async function seedWorkspace(): Promise<PrincipalId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `T-${suffix()}` })
    .returning()
  await testDb.insert(channelAccounts).values({
    owningTeamId: team.id as TeamId,
    role: 'inbound',
    channel: 'email',
    address: 'support@quackback.io',
    inboundTrust: 'strict',
  })
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Test',
    slug: `t-${suffix()}`,
    createdAt: new Date(),
    spamFilterConfig: JSON.stringify({ trustedSenders: [] }),
  })
  const userId = createId('user') as UserId
  const admin = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Agent', email: `agent-${suffix()}@q.test` })
  await testDb.insert(principal).values({
    id: admin,
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
  return admin
}

const coldEmail = (over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail => ({
  toAddresses: ['support@quackback.io'],
  ccAddresses: [],
  replyToAddresses: [],
  from: 'customer@acme.com',
  subject: 'Help with billing',
  text: 'My invoice looks wrong.',
  messageId: `<${suffix()}@acme.com>`,
  emailId: null,
  inReplyTo: null,
  references: [],
  autoSubmitted: null,
  autoResponseSuppress: null,
  precedence: null,
  hasListHeaders: false,
  authenticationResults: 'mx.quackback.io; spf=pass; dmarc=pass (p=reject) header.from=acme.com',
  ...over,
})

/** Bulk mail with no thread headers: the auto-responder rule files it, no AI. */
const bulkEmail = () =>
  coldEmail({
    from: 'noreply@bulk-mailer.example',
    precedence: 'bulk',
    subject: 'Limited-time offer inside',
    text: 'Buy now, act fast.',
  })

/**
 * Resolve the team bell for the conversation's `message.created` outbox event
 * now, as the event-dispatch worker would after ingest (and any filing) ran.
 * Returns the principals the bell would ring, and whether the event was there.
 */
async function bellRecipients(
  conversationId: ConversationId
): Promise<{ eventFound: boolean; recipients: string[] }> {
  const rows = await testDb
    .select()
    .from(events)
    .where(and(eq(events.type, 'message.created'), eq(events.entityId, conversationId)))
  const recipients: string[] = []
  for (const row of rows) {
    const targets = await notificationResolver.resolve(hydrateEvent(row))
    for (const t of targets) {
      if (t.type !== 'notification') continue
      recipients.push(...(t.target as { principalIds: string[] }).principalIds)
    }
  }
  return { eventFound: rows.length > 0, recipients }
}

async function ingestFiled(): Promise<{ admin: PrincipalId; conversationId: ConversationId }> {
  const admin = await seedWorkspace()
  const res = await ingestParsedEmail(bulkEmail())
  if (res.status !== 'ingested') throw new Error(`expected ingested, got ${res.status}`)
  return { admin, conversationId: res.conversationId }
}

describe.skipIf(!fixture.available)('spam auto-filing stays quiet (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('control: a legitimate cold email bells the teammate who can see it', async () => {
    const admin = await seedWorkspace()
    mockChat.mockResolvedValue({ spam: false })
    const res = await ingestParsedEmail(coldEmail())
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return
    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('open')
    const bell = await bellRecipients(res.conversationId)
    expect(bell.eventFound).toBe(true)
    expect(bell.recipients).toContain(admin)
  })

  it('a deterministic rule files the cold email into Spam as it arrives, with its reason', async () => {
    const { conversationId } = await ingestFiled()
    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    })
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('auto_responder')
    expect(stored?.endNote).toContain('Auto-filed by the spam filter')
    expect(mockChat).not.toHaveBeenCalled()
    // Filed in its insert, like quarantined mail: no message event is written,
    // so nothing downstream (bells, workflows, webhooks) can react to it.
    expect((await bellRecipients(conversationId)).eventFound).toBe(false)
  })

  // INB-62: a cold email a fixed rule files as spam rings no one.
  it('a spam-filed cold email rings no team bell', async () => {
    const { conversationId } = await ingestFiled()
    expect((await bellRecipients(conversationId)).recipients).toEqual([])
  })
})
