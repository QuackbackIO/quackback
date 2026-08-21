/**
 * End-to-end proof of the inbound auto-spam filter (real DB, rolled back):
 * a cold inbound email the classifier scores as spam is auto-filed — closed
 * with endReason 'spam', out of triage, surfaced by the Spam view — while a
 * legitimate verdict leaves the thread open, and a workspace-trusted sender
 * bypasses classification entirely. The AI completion is mocked at the same
 * seams the unit test uses; everything below it (ingest, filing, view query)
 * is real.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type TeamId, type UserId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  principal,
  settings,
  user,
  eq,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Event dispatch + realtime need runtime config; stub them (the ingest test's
// idiom). conversationToDTO is stubbed so the Spam-view query doesn't need the
// full card graph.
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
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
vi.mock('@/lib/server/storage/s3', async (importOriginal) => {
  const { config } = await import('@/lib/server/config')
  return {
    ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
    isS3Configured: () => true,
    uploadImageBuffer: async (bytes: Buffer, mime: string) => ({
      url: `${config.baseUrl}/api/storage/chat-images/img-${bytes.length}.${mime.split('/')[1]}`,
    }),
    uploadObject: async (key: string) => `${config.baseUrl}/api/storage/${key}`,
  }
})

// AI seams: the verdict is the variable under test; everything around it is real.
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
import { listConversationsForAgent } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

let agentPrincipalId: PrincipalId | null = null

async function seedWorkspace(trustedSenders: string[] = []): Promise<void> {
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
  // Exactly one settings row inside the rolled-back transaction, so
  // requireSettings resolves deterministically to this workspace's config.
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Test',
    slug: `t-${suffix()}`,
    createdAt: new Date(),
    spamFilterConfig: JSON.stringify({ trustedSenders }),
  })
  // An agent for the Spam-view query.
  const agentUserId = createId('user') as UserId
  agentPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: agentUserId, name: 'Agent' })
  await testDb.insert(principal).values({
    id: agentPrincipalId,
    userId: agentUserId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
}

function agentActor(): Actor {
  return {
    principalId: agentPrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

const coldEmail = (over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail => ({
  toAddresses: ['support@quackback.io'],
  ccAddresses: [],
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

async function spamViewIds(): Promise<string[]> {
  const page = await listConversationsForAgent({ spamOnly: true }, agentActor())
  return page.conversations.map((c) => c.id)
}

/** The Spam-view DTO's filing-reason badge field for one conversation. */
async function spamViewReason(id: string): Promise<string | null> {
  const page = await listConversationsForAgent({ spamOnly: true }, agentActor())
  return page.conversations.find((c) => c.id === id)?.spamReason ?? null
}

describe.skipIf(!fixture.available)('inbound auto-spam filter (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('auto-files an obvious-spam cold inbound into the Spam view', async () => {
    await seedWorkspace()
    mockChat.mockResolvedValue({ spam: true })

    const res = await ingestParsedEmail(
      coldEmail({
        from: 'promo@bulk-deals.example',
        subject: 'YOU WON A FREE CRUISE',
        text: 'Congratulations! Claim your prize now, limited offer, click here.',
      })
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('ai_classifier')
    // And the Spam view is the list that surfaces it — with the filing reason.
    await expect(spamViewIds()).resolves.toContain(res.conversationId)
    await expect(spamViewReason(res.conversationId)).resolves.toBe('ai_classifier')
  })

  it('leaves a legitimate message in triage untouched', async () => {
    await seedWorkspace()
    mockChat.mockResolvedValue({ spam: false })

    const res = await ingestParsedEmail(coldEmail())
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
    await expect(spamViewIds()).resolves.not.toContain(res.conversationId)
  })

  it('bypasses classification for a workspace-trusted sender', async () => {
    await seedWorkspace(['acme.com'])
    mockChat.mockResolvedValue({ spam: true })

    const res = await ingestParsedEmail(coldEmail())
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    // The classifier verdict was spam, yet the trusted domain kept the thread open.
    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
  })

  it('files a cold auto-responder to Spam without invoking the AI classifier', async () => {
    await seedWorkspace()
    mockChat.mockResolvedValue({ spam: false })

    const res = await ingestParsedEmail(
      coldEmail({
        from: 'noreply@bulk-mailer.example',
        precedence: 'bulk',
        subject: 'Limited-time offer inside',
        text: 'Buy now, act fast.',
      })
    )
    // No threading headers and no plus-address: ingested, not suppressed.
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('auto_responder')
    await expect(spamViewIds()).resolves.toContain(res.conversationId)
    await expect(spamViewReason(res.conversationId)).resolves.toBe('auto_responder')
    // The deterministic signal filed it; the AI path never ran.
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('still hard-drops an auto-responder that replies to an existing thread', async () => {
    await seedWorkspace()
    const res = await ingestParsedEmail(
      coldEmail({
        precedence: 'bulk',
        inReplyTo: '<some-thread@acme.com>',
        references: ['<some-thread@acme.com>'],
      })
    )
    expect(res.status).toBe('suppressed')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('files a sender-auth failure to Spam without invoking the AI classifier', async () => {
    await seedWorkspace()
    mockChat.mockResolvedValue({ spam: false })

    const res = await ingestParsedEmail(
      coldEmail({
        from: 'spoofer@lookalike.example',
        authenticationResults:
          'mx.quackback.io; spf=fail; dmarc=fail (p=none) header.from=lookalike.example',
      })
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('sender_auth_failure')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('files a bursting sender to Spam without invoking the AI classifier', async () => {
    await seedWorkspace()
    mockChat.mockResolvedValue({ spam: false })
    const { incrementBucket } = await import('@/lib/server/utils/rate-bucket')
    vi.mocked(incrementBucket).mockImplementation(async (spec: { key: string }) => ({
      count: spec.key.includes(':burst:') ? 5 : 1,
    }))

    const res = await ingestParsedEmail(coldEmail({ from: 'flooder@acme.com' }))
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('closed')
    expect(stored?.endReason).toBe('spam')
    expect(stored?.spamReason).toBe('burst_rate')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('keeps a trusted sender in triage even when a signal matches', async () => {
    await seedWorkspace(['bulk-mailer.example'])
    mockChat.mockResolvedValue({ spam: false })

    const res = await ingestParsedEmail(
      coldEmail({ from: 'noreply@bulk-mailer.example', precedence: 'bulk' })
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const stored = await testDb.query.conversations.findFirst({
      where: eq(conversations.id, res.conversationId),
    })
    expect(stored?.status).toBe('open')
    expect(stored?.endReason).toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })
})
