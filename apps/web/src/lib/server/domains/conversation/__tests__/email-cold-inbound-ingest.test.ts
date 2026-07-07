/**
 * Real-DB coverage for the cold-inbound ingest wiring (§4.8 Layer 2): a fresh
 * email to an inbound route opens an email conversation via the DMARC-gated
 * sender resolution; an email to no known route is left alone. The
 * conversation.created emit is mocked (it dispatches events that need runtime
 * config); the conversation/message/lead writes are real. Fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'

// config is read lazily (getters), so seeding the required env before any config
// access makes config.baseUrl resolve — the insert-time trusted-url gate
// (restrictImagesToTrustedOrigins) needs it to accept the rehosted image src.
// The harness leaves BASE_URL as a bare "/" (not a valid absolute URL), so set an
// absolute one unconditionally for this file's config load.
process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)
process.env.REDIS_URL ||= 'redis://localhost:6379'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  conversationMessages,
  principal,
  eq,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// The created-event emit dispatches to the bus (needs runtime config); stub it.
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
}))
// Storage is mocked so media rehosting never touches real S3; the mock returns
// own-storage URLs (config.baseUrl + /api/storage/...) so they pass the trusted-
// url gate the direct cold-inbound insert re-applies.
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

import { ingestParsedEmail } from '../conversation.email-inbound.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedInboundRoute(address: string): Promise<void> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `T-${suffix()}` })
    .returning()
  await testDb.insert(channelAccounts).values({
    owningTeamId: team.id as TeamId,
    role: 'inbound',
    channel: 'email',
    address,
    inboundTrust: 'strict',
  })
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

describe.skipIf(!fixture.available)('cold-inbound ingest (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('opens an email conversation for a fresh mail to an inbound route', async () => {
    await seedInboundRoute('support@quackback.io')

    const res = await ingestParsedEmail(coldEmail())
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.channel).toBe('email')
    expect(conv.source).toBe('email')
    expect(conv.channelAccountId).not.toBeNull()
    expect(conv.waitingSince).not.toBeNull() // customer waiting on first reply
    expect(conv.subject).toBe('Help with billing')

    // The first message landed as a visitor message.
    const msgs = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, res.conversationId))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].senderType).toBe('visitor')

    // A DMARC-pass sender with no account -> a fresh lead carries the address.
    const [visitor] = await testDb
      .select({ type: principal.type, contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, conv.visitorPrincipalId))
    expect(visitor.type).toBe('anonymous')
    expect(visitor.contactEmail).toBe('customer@acme.com')
  })

  it('stores converted content + contentJson for an HTML-only cold inbound', async () => {
    await seedInboundRoute('support@quackback.io')

    const res = await ingestParsedEmail(
      coldEmail({ text: '', html: '<div dir="ltr">Invoice looks <b>wrong</b>.</div>' })
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const [msg] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, res.conversationId))
    // Placeholder gone: the plaintext mirror is the converted body.
    expect(msg.content).toBe('Invoice looks wrong.')
    expect(msg.content).not.toContain('no plain-text body')
    // The rich doc is persisted alongside it, formatting intact.
    expect(msg.contentJson).not.toBeNull()
    expect(JSON.stringify(msg.contentJson)).toContain('"bold"')
  })

  it('rehosts an inline cid image + stores a discrete attachment for cold inbound', async () => {
    await seedInboundRoute('support@quackback.io')
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ])
    const pdf = Buffer.from('%PDF-1.4 cold invoice payload')

    const res = await ingestParsedEmail(
      coldEmail({
        text: '',
        html: '<div dir="ltr">See logo <img src="cid:logo@c"> and the invoice.</div>',
        attachments: [
          {
            bytes: png,
            contentType: 'image/png',
            filename: 'logo.png',
            contentId: 'logo@c',
            disposition: 'inline',
          },
          {
            bytes: pdf,
            contentType: 'application/pdf',
            filename: 'invoice.pdf',
            contentId: null,
            disposition: 'attachment',
          },
        ],
      })
    )
    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return

    const [msg] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, res.conversationId))
    // Inline image rehosted into the body: a trusted own-storage src survives the
    // insert-time restrictImagesToTrustedOrigins sanitize; the cid ref is gone.
    const json = JSON.stringify(msg.contentJson)
    expect(json).toContain('/api/storage/chat-images')
    expect(json).not.toContain('cid:')
    // The PDF lands as a discrete attachment with its name/type/size.
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments![0]).toMatchObject({
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: pdf.length,
    })
  })

  it('leaves an email to no known route alone (no_conversation)', async () => {
    // No inbound route seeded for this address.
    const res = await ingestParsedEmail(coldEmail({ toAddresses: ['nobody@elsewhere.com'] }))
    expect(res.status).toBe('no_conversation')
  })

  it('drops a hard DMARC reject without opening a conversation', async () => {
    await seedInboundRoute('support@quackback.io')
    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('suppressed')
  })
})
