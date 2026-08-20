/**
 * Real-DB coverage for the cold-inbound ingest wiring (§4.8 Layer 2): a fresh
 * email to an inbound route opens an email conversation via the DMARC-gated
 * sender resolution; an email to no known route is left alone. The
 * conversation.created emit is mocked (it dispatches events that need runtime
 * config); the conversation/message/lead writes are real. Fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type UserId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

// config is read lazily (getters), so seeding the required env before any config
// access makes config.baseUrl resolve — the insert-time trusted-url gate
// (restrictImagesToTrustedOrigins) needs it to accept the rehosted image src.
// The harness leaves BASE_URL as a bare "/" (not a valid absolute URL), so set an
// absolute one unconditionally for this file's config load.
process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)
// The inbound channel has to be configured for a reply address to be minted at
// all, and the mail-loop guard's whole question is whether an address in front
// of it is one THIS install minted. Unconfigured, the guard is inert and a test
// of it would pass against a guard wired to nothing.
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  conversationMessages,
  conversationOutboundEmails,
  principal,
  user,
  eq,
  sql,
  CONVERSATION_SPAM_FILED_BY,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Both emits dispatch to the bus (needs runtime config); stub them. Leaving
// emitMessageCreated real would run dispatchEvent inside the rolled-back fixture.
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
// restoreConversationFromSpam publishes a realtime update and projects a DTO;
// neither needs to be real to prove what the release did to the stored row.
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))
vi.mock('../conversation.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string; status: string }) => ({
    id: row.id,
    status: row.status,
  })),
}))
// The cold-inbound throttle is a real rate bucket keyed on the sender address,
// which this file's fixture hardcodes. Left live, the cases below would burn a
// shared 10-per-hour budget and start failing as 'rate_limited' on repeated
// local runs — a red suite that points nowhere near its cause. Count the calls
// instead; the bucket arithmetic is pinned in conversation-ratelimit.test.ts.
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn().mockResolvedValue({ count: 1 }),
  incrementBuckets: vi.fn().mockResolvedValue([1]),
  bucketRetryAfter: vi.fn().mockResolvedValue(60),
}))
// Storage is mocked so media rehosting never touches real S3; the mock returns
// own-storage URLs (config.baseUrl + /api/storage/...) so they pass the trusted-
// url gate the direct cold-inbound insert re-applies.
vi.mock('@/lib/server/storage/s3', async (importOriginal) => {
  const { config } = await import('@/lib/server/config')
  return {
    ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
    isS3Usable: () => true,
    uploadImageBuffer: async (bytes: Buffer, mime: string) => ({
      url: `${config.baseUrl}/api/storage/chat-images/img-${bytes.length}.${mime.split('/')[1]}`,
    }),
    uploadObject: async (key: string) => `${config.baseUrl}/api/storage/${key}`,
  }
})

import { ingestParsedEmail } from '../conversation.email-inbound.service'
import { parseRawEmail } from '../conversation.email-inbound'
// The real minter and the real store, so a fixture that claims to be one of our
// own mails is one the running system would have produced and recorded.
import { inboundReplyToAddress } from '../conversation.email-channel'
import { SELF_HOSTED_MAIL_SLUG } from '../conversation.mail-slug'
import { recordOutboundEmail } from '../conversation.email-store'
import { emitConversationCreated, emitMessageCreated } from '../conversation.webhooks'
import { incrementBucket } from '@/lib/server/utils/rate-bucket'
import { restoreConversationFromSpam } from '../conversation.service'
import { sweepFiledSpamConversations, SPAM_RETENTION_DAYS } from '../conversation.spam-retention'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/**
 * Seed a user and its principal. `createdAt` is written explicitly rather than
 * left to the column default, matching the spam-lifecycle suite's idiom.
 */
async function seedAccount(name: string, email?: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, ...(email ? { email } : {}) })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, type: 'user', role: 'user', createdAt: new Date() })
  return principalId
}

/** An agent, for the deliberate release act. */
async function agentActorAsync(): Promise<Actor> {
  const principalId = await seedAccount('Agent')
  return { principalId, role: 'admin', principalType: 'user', segmentIds: new Set() }
}

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

describe.skipIf(!fixture.available)('cold-inbound ingest (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  // Four cases below ingest a cold email, so the emit mocks accumulate calls
  // across them; without this reset the call-count assertions would silently
  // depend on this file's test order. clearAllMocks keeps implementations.
  beforeEach(() => vi.clearAllMocks())
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

    // message.created is what the team bell, message-triggered workflows and the
    // next-response SLA clock ride. Without it an emailed-in thread notifies
    // nobody. `true` is the first-message flag the bell's anti-spam gate reads.
    expect(vi.mocked(emitMessageCreated)).toHaveBeenCalledTimes(1)
    const [, , emittedMessage, emittedConversation, isFirstMessage] =
      vi.mocked(emitMessageCreated).mock.calls[0]
    expect(emittedMessage.id).toBe(msgs[0].id)
    expect(emittedConversation.id).toBe(res.conversationId)
    expect(isFirstMessage).toBe(true)
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

  // THE DEFECT THIS SUITE EXISTS FOR. A hard DMARC reject used to return
  // 'suppressed' having persisted nothing at all — a legitimate customer behind
  // a forwarding gateway vanished, the sender believed it was delivered, and no
  // agent could ever learn it had arrived. Retention is the fix, so this case
  // asserts the bytes SURVIVED, not merely that a status changed.
  it('retains a hard DMARC reject in Spam instead of destroying it', async () => {
    await seedInboundRoute('support@quackback.io')

    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )

    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv).toBeDefined()
    // The message itself is what had to survive.
    const msgs = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, res.conversationId))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('My invoice looks wrong.')
    expect(msgs[0].senderType).toBe('visitor')
  })

  // An enumerated cause, not a sentence: it is what makes the refusal queryable
  // and what the Spam view badges the row with. 'sender_auth_reject' is
  // deliberately distinct from the pre-existing 'sender_auth_failure' — one is
  // "the author domain told us to refuse this", the other is "DMARC was weak".
  it('records the refusal cause on the retained thread, from the enumerated set', async () => {
    await seedInboundRoute('support@quackback.io')

    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return
    expect(res.cause).toBe('sender_auth_reject')

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.spamReason).toBe('sender_auth_reject')
    expect(CONVERSATION_SPAM_FILED_BY).toContain(conv.spamReason)
    // Filed in the insert, so it is in the Spam view and out of triage from the
    // first instant — never open, not even briefly.
    expect(conv.status).toBe('closed')
    expect(conv.endReason).toBe('spam')
    expect(conv.resolvedAt).not.toBeNull()
  })

  // A validated ARC chain is the forwarding-gateway shape and the case most
  // likely to be a real customer, so it must not be indistinguishable from a
  // plain DMARC failure once it is sitting in the Spam view.
  it('distinguishes an ARC-rescued sender from a plain sender-auth failure', async () => {
    await seedInboundRoute('support@quackback.io')

    const rescued = await ingestParsedEmail(
      coldEmail({
        authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com; arc=pass',
      })
    )
    expect(rescued.status).toBe('ingested')
    if (rescued.status !== 'ingested') return
    const [rescuedConv] = await testDb
      .select({ spamReason: conversations.spamReason })
      .from(conversations)
      .where(eq(conversations.id, rescued.conversationId))
    expect(rescuedConv.spamReason).toBe('sender_auth_arc_rescued')

    const weak = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=none) header.from=acme.com' })
    )
    expect(weak.status).toBe('ingested')
    if (weak.status !== 'ingested') return
    const [weakConv] = await testDb
      .select({ spamReason: conversations.spamReason })
      .from(conversations)
      .where(eq(conversations.id, weak.conversationId))
    expect(weakConv.spamReason).toBe('sender_auth_failure')
  })

  // Requirement: retaining the message must not soften the verdict. A refused
  // message is attributed to a standalone unverified lead, badged, and raises
  // none of the signals an accepted message raises — a bell any stranger can
  // ring by forging a From is a notification channel handed to them, and a
  // message workflow firing on one is backscatter sent in our name.
  it('confers no identity and raises no signals for a retained refusal', async () => {
    await seedInboundRoute('support@quackback.io')
    // The account the spoofer is impersonating.
    const spoofedPrincipalId = await seedAccount('Real Customer', 'customer@acme.com')

    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    const [visitor] = await testDb
      .select({ userId: principal.userId, type: principal.type })
      .from(principal)
      .where(eq(principal.id, conv.visitorPrincipalId))
    // Not the spoofed account, and not any account.
    expect(conv.visitorPrincipalId).not.toBe(spoofedPrincipalId)
    expect(visitor.userId).toBeNull()
    expect(visitor.type).toBe('anonymous')
    expect(conv.customAttributes).toMatchObject({ unverifiedSender: true })
    // Nobody is waiting on refused mail.
    expect(conv.waitingSince).toBeNull()
    expect(vi.mocked(emitMessageCreated)).not.toHaveBeenCalled()
    expect(vi.mocked(emitConversationCreated)).not.toHaveBeenCalled()
  })

  // Release is the recourse half of the fix: an agent restores the thread and
  // it rejoins the queue — as an UNVERIFIED message would have, attached to
  // nothing. A release that adopted the spoofed account would hand the spoofer
  // the identity the refusal existed to withhold.
  it('releases a retained refusal into the queue without conferring identity', async () => {
    await seedInboundRoute('support@quackback.io')
    const spoofedPrincipalId = await seedAccount('Real Customer', 'customer@acme.com')

    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return

    const restored = await restoreConversationFromSpam(res.conversationId, await agentActorAsync())

    expect(restored.status).toBe('open')
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.status).toBe('open')
    expect(conv.endReason).toBeNull()
    expect(conv.spamReason).toBeNull()
    // The load-bearing assertion: release did not migrate the thread onto the
    // account that owns the address, and the badge is still on it.
    expect(conv.visitorPrincipalId).not.toBe(spoofedPrincipalId)
    const [visitor] = await testDb
      .select({ userId: principal.userId })
      .from(principal)
      .where(eq(principal.id, conv.visitorPrincipalId))
    expect(visitor.userId).toBeNull()
    expect(conv.customAttributes).toMatchObject({ unverifiedSender: true })
  })

  // Retention has to have a ceiling or an unauthenticated stranger decides how
  // much storage this workspace spends. The window's justification lives in
  // conversation.spam-retention.ts; this pins that the sweep reaches quarantined
  // mail at all, and that a released thread is out of its reach.
  it('sweeps a retained refusal once it is past the retention window', async () => {
    await seedInboundRoute('support@quackback.io')
    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return

    // Inside the window: untouched.
    expect((await sweepFiledSpamConversations()).deleted).toBe(0)
    expect(
      await testDb
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, res.conversationId))
    ).toHaveLength(1)

    // Age the filing past the window.
    await testDb
      .update(conversations)
      .set({ resolvedAt: new Date(Date.now() - (SPAM_RETENTION_DAYS + 1) * 86_400_000) })
      .where(eq(conversations.id, res.conversationId))

    expect((await sweepFiledSpamConversations()).deleted).toBe(1)
    expect(
      await testDb
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, res.conversationId))
    ).toHaveLength(0)
  })

  it('never sweeps a refusal an agent released, however old the filing', async () => {
    await seedInboundRoute('support@quackback.io')
    const res = await ingestParsedEmail(
      coldEmail({ authenticationResults: 'mx; dmarc=fail (p=reject) header.from=acme.com' })
    )
    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return

    await restoreConversationFromSpam(res.conversationId, await agentActorAsync())
    // Backdate what the sweep would have keyed on; the release already cleared
    // end_reason, so the row is out of the candidate set regardless.
    await testDb
      .update(conversations)
      .set({ resolvedAt: new Date(Date.now() - (SPAM_RETENTION_DAYS + 100) * 86_400_000) })
      .where(eq(conversations.id, res.conversationId))

    expect((await sweepFiledSpamConversations()).deleted).toBe(0)
    expect(
      await testDb
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, res.conversationId))
    ).toHaveLength(1)
  })

  // Cold inbound is the only ingress that mints a principal for an
  // unauthenticated stranger, so the throttle has to bite BEFORE resolution —
  // a gate placed after it has already let the row be created.
  it('rate-limits a flooding sender without creating a principal or conversation', async () => {
    await seedInboundRoute('support@quackback.io')
    const [{ count: principalsBefore }] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)
    // Over the 10-per-hour cold budget.
    vi.mocked(incrementBucket).mockResolvedValueOnce({ count: 11 })

    const res = await ingestParsedEmail(coldEmail())

    expect(res.status).toBe('rate_limited')
    const [{ count: principalsAfter }] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)
    expect(principalsAfter).toBe(principalsBefore)
    const convs = await testDb.select({ id: conversations.id }).from(conversations)
    expect(convs).toHaveLength(0)
  })

  // An unparseable From has no key to throttle on, and used to mint a lead with
  // a null contact email on a thread nobody could ever reply to.
  it('drops an unparseable From before spending a rate-limit token', async () => {
    await seedInboundRoute('support@quackback.io')

    const res = await ingestParsedEmail(coldEmail({ from: 'not an address' }))

    expect(res.status).toBe('from_mismatch')
    expect(vi.mocked(incrementBucket)).not.toHaveBeenCalled()
  })

  // Without reuse, every mail mints a fresh principal, so a block can never bite
  // and the junk is unreclaimable (the anon sweep skips anything owning a
  // conversation). The display-name variant pins that normalization is what
  // makes the match work — a raw From header would key a second lead.
  it('reuses the lead a previous mail from the same address created', async () => {
    await seedInboundRoute('support@quackback.io')

    const first = await ingestParsedEmail(coldEmail())
    expect(first.status).toBe('ingested')
    if (first.status !== 'ingested') return
    const [{ count: afterFirst }] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)

    const second = await ingestParsedEmail(coldEmail({ from: '"Jane Doe" <customer@acme.com>' }))
    expect(second.status).toBe('ingested')
    if (second.status !== 'ingested') return

    const [convA] = await testDb
      .select({ visitor: conversations.visitorPrincipalId, email: conversations.visitorEmail })
      .from(conversations)
      .where(eq(conversations.id, first.conversationId))
    const [convB] = await testDb
      .select({ visitor: conversations.visitorPrincipalId, email: conversations.visitorEmail })
      .from(conversations)
      .where(eq(conversations.id, second.conversationId))

    expect(convB.visitor).toBe(convA.visitor)
    // The bare address is stored either way — never the raw header.
    expect(convB.email).toBe('customer@acme.com')
    const [{ count: afterSecond }] = await testDb
      .select({ count: sql<number>`count(*)::int` })
      .from(principal)
    expect(afterSecond).toBe(afterFirst)
  })

  // ==========================================================================
  // The mail-loop guard, on the rung the transport it exists for delivers: raw
  // MIME, carrying a `Message-ID` the sending provider assigned rather than one
  // we minted. Two signals reach two different dispositions here, and the whole
  // point of the pair is that they are NOT the same disposition.
  // ==========================================================================

  /** Our own notification, echoed back into the support inbox by a forwarding
   *  rule. Everything that used to identify it as ours is gone from the wire
   *  except the reply address we minted and put on it ourselves. */
  const loopingMail = (replyTo: string): string =>
    [
      'From: Support <noreply@quackback.test>',
      'To: support@quackback.io',
      `Reply-To: Acme Support <${replyTo}>`,
      'Subject: New reply from Acme',
      'Message-ID: <0100019a1f4c8e21-6b2d@email.amazonses.com>',
      'Authentication-Results: mx.quackback.io; spf=pass; dmarc=pass (p=none) header.from=quackback.test',
      '',
      'An agent replied to your conversation.',
    ].join('\r\n')

  // RETAINED, not destroyed. `Reply-To` is a header any sender controls, so this
  // is our own guess about authorship rather than a fact — and a wrong guess
  // here is unattributable as well as unrecoverable: the refusal log carries a
  // cause and nothing else (no address may be written to it), so a customer
  // saying "I replied and nothing happened" leaves nobody anything to match.
  // That is the same reasoning that quarantines a sender-auth refusal above.
  it('retains a suspected mail loop in Spam instead of destroying it', async () => {
    await seedInboundRoute('support@quackback.io')
    const ours = inboundReplyToAddress(
      createId('conversation') as ConversationId,
      SELF_HOSTED_MAIL_SLUG
    )!

    const res = await ingestParsedEmail(parseRawEmail(loopingMail(ours)))

    expect(res.status).toBe('quarantined')
    if (res.status !== 'quarantined') return
    expect(res.cause).toBe('mail_loop_suspected')

    // The bytes had to survive, which is the whole difference from a drop.
    const msgs = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, res.conversationId))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('An agent replied to your conversation.')

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.spamReason).toBe('mail_loop_suspected')
    expect(CONVERSATION_SPAM_FILED_BY).toContain(conv.spamReason)
    // Filed in the insert: in the Spam view and out of triage from the first
    // instant. Retention must not cost the suppression the guard exists for —
    // nobody is waiting on it, and it rings no bell and starts no clock.
    expect(conv.status).toBe('closed')
    expect(conv.endReason).toBe('spam')
    expect(conv.waitingSince).toBeNull()
    expect(vi.mocked(emitMessageCreated)).not.toHaveBeenCalled()
    expect(vi.mocked(emitConversationCreated)).not.toHaveBeenCalled()
  })

  // The discriminator. This address is minted by the same code with the same
  // fleet-wide secret and verifies perfectly; only its workspace LABEL differs.
  // Without this case the test above would pass just as happily against a guard
  // that accepted any address at our inbound domain, which on a shared domain is
  // every neighbour's mail.
  it('leaves a neighbouring workspace’s reply address alone', async () => {
    await seedInboundRoute('support@quackback.io')
    const neighbours = inboundReplyToAddress(createId('conversation') as ConversationId, 'ws-t2')!
    expect(neighbours).not.toBeNull()

    const res = await ingestParsedEmail(parseRawEmail(loopingMail(neighbours)))

    expect(res.status).toBe('ingested')
    if (res.status !== 'ingested') return
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, res.conversationId))
    expect(conv.spamReason).toBeNull()
    expect(conv.status).toBe('open')
  })

  // The exact test, and the only signal of the three that is a FACT: not an id
  // shaped like ours, but a row this workspace wrote when its own mail went out.
  // Recorded bare (as the sending provider's API reports it) and arriving hosted
  // (as the header it signed carries it), so this also pins that the two forms
  // are reconciled by the store rather than by a string match here.
  it('hard-drops a message whose own Message-ID is one we recorded going out', async () => {
    await seedInboundRoute('support@quackback.io')
    const opened = await ingestParsedEmail(coldEmail())
    expect(opened.status).toBe('ingested')
    if (opened.status !== 'ingested') return
    await recordOutboundEmail('0100019a1f4c8e21-6b2d', opened.conversationId)
    expect(await testDb.select().from(conversationOutboundEmails)).toHaveLength(1)

    const res = await ingestParsedEmail(
      coldEmail({ messageId: '<0100019a1f4c8e21-6b2d@email.amazonses.com>' })
    )

    expect(res.status).toBe('suppressed')
    // Nothing retained, because nothing was guessed: our own mail coming back is
    // noise at best and a self-feeding loop at worst.
    expect(await testDb.select({ id: conversations.id }).from(conversations)).toHaveLength(1)
  })

  it('suppresses a blocked sender without opening a conversation', async () => {
    await seedInboundRoute('support@quackback.io')
    // A lead an earlier mail created, since blocked. createdAt is set explicitly
    // because the column's default lives in the factory, not in the schema.
    await testDb.insert(principal).values({
      role: 'user',
      type: 'anonymous',
      contactEmail: 'customer@acme.com',
      createdAt: new Date(),
      blockedAt: new Date(),
    })

    const res = await ingestParsedEmail(coldEmail())

    expect(res.status).toBe('suppressed')
    const convs = await testDb.select({ id: conversations.id }).from(conversations)
    expect(convs).toHaveLength(0)
  })
})
