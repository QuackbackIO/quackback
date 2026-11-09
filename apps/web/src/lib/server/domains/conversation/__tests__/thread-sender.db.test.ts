/**
 * One support thread, one sender, end to end.
 *
 * A customer emails in, and the thread then receives the four kinds of email a
 * conversation sends them: the automatic acknowledgement, an agent's reply, the
 * rating request and the closing notice. To the customer these are one
 * conversation, so they have to come from one address and sit in one thread in
 * their mail client. Checked on the wire: the mail is delivered over SMTP to a
 * listener this file runs, so the From, subject and threading headers asserted
 * here are the ones the message actually left with.
 *
 * Then support is pointed at another address and the conversation reassigned,
 * and the next reply must still come from the address the thread started on.
 *
 * Pooled tenancy is on so the send guard is live: on a single-workspace install
 * it permits every address and would prove nothing about which one is chosen.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll, vi } from 'vitest'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { createId, type PrincipalId, type TeamId, type UserId } from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  isNull,
  channelAccounts,
  conversations,
  emailSendingDomains,
  principal,
  teams,
  user,
} from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
// A real bucket keyed on the sender address would burn a shared hourly budget
// across repeated local runs; its arithmetic is pinned in its own suite.
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn().mockResolvedValue({ count: 1 }),
  incrementBuckets: vi.fn().mockResolvedValue([1]),
  bucketRetryAfter: vi.fn().mockResolvedValue(60),
}))
// Off while the message is ingested, so the acknowledgement ingest fires and
// forgets cannot race the one this test sends and awaits.
const autoAck = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/lib/server/domains/settings/settings.email-auto-ack', () => ({
  getEmailAutoAck: async () => ({ enabled: autoAck.enabled }),
}))
vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Example Co',
    portalBaseUrl: 'https://portal.example.test',
    logoUrl: null,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  requireSettings: async () => ({ name: 'Example Co' }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/settings/settings.support')>()),
  isPortalSupportEnabled: async () => false,
}))

import { ingestParsedEmail } from '../conversation.email-inbound.service'
import { maybeSendColdInboundAck } from '../conversation.auto-ack'
import { notifyAgentReply, notifyCsatRequestEmail } from '../conversation.notify'
import { notifyConversationClosed } from '../conversation.notify-closed'
import { createSendingAddress } from '@/lib/server/domains/channel-accounts/channel-account.service'
import { setEmailSender } from '@/lib/server/domains/channel-accounts/email-senders'
import { resolveSendingAddress } from '@/lib/server/domains/channel-accounts/sender-resolver'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: conversations.threadSenderAddress }).from(conversations).limit(0)
  },
})

const WORKSPACE = 'thread-sender'
const INBOUND_DOMAIN = 'mail.platform.test'
const PLATFORM_ADDRESS = `${mailSlugFor(WORKSPACE)}@${INBOUND_DOMAIN}`
const CUSTOMER = 'customer@example.org'
const CUSTOMER_MESSAGE_ID = 'first-message@example.org'

// ============================================================================
// A minimal SMTP listener: accepts every message and keeps its headers.
// ============================================================================

interface WireMail {
  to: string[]
  headers: Map<string, string>
}

const received: WireMail[] = []

/** Header block of a raw RFC 5322 message, unfolded, keyed lower-case. */
function parseHeaders(raw: string): Map<string, string> {
  const head = raw.split(/\r\n\r\n/)[0].replace(/\r\n[ \t]+/g, ' ')
  const headers = new Map<string, string>()
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim())
  }
  return headers
}

function startSmtp(): Promise<Server> {
  const server = createServer((socket) => {
    let buffer = ''
    let inData = false
    let rcpt: string[] = []
    socket.write('220 smtp.test ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          const raw = buffer.slice(0, end).replace(/\r\n\.\./g, '\r\n.')
          buffer = buffer.slice(end + 5)
          inData = false
          received.push({ to: rcpt, headers: parseHeaders(raw) })
          rcpt = []
          socket.write('250 OK\r\n')
          continue
        }
        const eol = buffer.indexOf('\r\n')
        if (eol === -1) return
        const line = buffer.slice(0, eol)
        buffer = buffer.slice(eol + 2)
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 smtp.test\r\n')
        else if (verb === 'RCPT') {
          rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          socket.write('250 OK\r\n')
        } else if (verb === 'DATA') {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (verb === 'QUIT') {
          socket.end('221 Bye\r\n')
        } else socket.write('250 OK\r\n')
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

let smtp: Server
let smtpPort = 0
beforeAll(async () => {
  smtp = await startSmtp()
  smtpPort = (smtp.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => smtp.close(() => resolve())))

const ENV: Record<string, string> = {
  QUACKBACK_TENANCY: 'pooled',
  EMAIL_SMTP_HOST: '127.0.0.1',
  EMAIL_FROM: 'Platform <notifications@mail.platform.test>',
  EMAIL_INBOUND_DOMAIN: INBOUND_DOMAIN,
  EMAIL_INBOUND_SIGNING_SECRET: 'whsec_dGVzdHNlY3JldA==',
}

const asWorkspace = <T>(fn: () => T): T => withWorkspace(WORKSPACE, fn)

const coldEmail: ParsedInboundEmail = {
  toAddresses: [PLATFORM_ADDRESS],
  ccAddresses: [],
  replyToAddresses: [],
  from: `Casey <${CUSTOMER}>`,
  subject: 'Help with billing',
  text: 'My invoice looks wrong.',
  messageId: `<${CUSTOMER_MESSAGE_ID}>`,
  emailId: null,
  inReplyTo: null,
  references: [],
  autoSubmitted: null,
  autoResponseSuppress: null,
  precedence: null,
  hasListHeaders: false,
  authenticationResults: 'mx; spf=pass; dmarc=pass (p=reject) header.from=example.org',
}

async function defaultTeam(): Promise<TeamId> {
  const [team] = await testDb
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)))
    .limit(1)
  expect(team?.id, 'a workspace is seeded with one default team').toBeTruthy()
  return team.id
}

async function verifyDomain(owningTeamId: TeamId, domain: string): Promise<void> {
  const now = new Date()
  await testDb.insert(emailSendingDomains).values({
    owningTeamId,
    domain,
    status: 'verified',
    verifiedAt: now,
    lastCheckedAt: now,
    dnsRecords: [
      {
        type: 'TXT',
        host: '_quackback',
        value: 'quackback-domain-verification=2b7e151628aed2a6',
        purpose: 'ownership',
      },
    ],
  })
}

/** An agent to reply as. */
async function seedAgent(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Alex', email: 'alex@home.example' })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/** Every mail that reached the customer, in send order, as header maps. */
function customerMail(): Array<Map<string, string>> {
  return received.filter((mail) => mail.to.includes(CUSTOMER)).map((mail) => mail.headers)
}

function bareFrom(from: string | undefined): string {
  const match = /<([^>]+)>$/.exec(String(from))
  return match ? match[1] : String(from)
}

/** A Message-ID without its angle brackets, in the lower case the store keeps it in. */
function bareId(id: string | undefined): string {
  return String(id).replace(/^<|>$/g, '').toLowerCase()
}

/** A References header as a list of bare ids. */
function referenceIds(mail: Map<string, string>): string[] {
  return (mail.get('references') ?? '').split(/\s+/).filter(Boolean).map(bareId)
}

describe.skipIf(!fixture.available)('one sender for a whole support thread (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value)
    vi.stubEnv('EMAIL_SMTP_PORT', String(smtpPort))
    received.length = 0
    autoAck.enabled = false
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('sends the acknowledgement, a reply, the rating request and the closing notice as one thread from one address', async () => {
    const home = await defaultTeam()
    await verifyDomain(home, 'home.example')
    // Named on its own, so every email below shows the address's sender name
    // rather than the workspace's.
    await createSendingAddress({
      owningTeamId: home,
      address: 'help@home.example',
      senderName: 'Example Support',
    })
    // A second live address, which support is later pointed at.
    const [billing] = await testDb.insert(teams).values({ name: 'Billing' }).returning()
    const billingAddress = await createSendingAddress({
      owningTeamId: home,
      address: 'billing@home.example',
    })
    const agent = await seedAgent()

    const ingested = await asWorkspace(() => ingestParsedEmail(coldEmail))
    expect(ingested.status).toBe('ingested')
    if (ingested.status !== 'ingested') return
    const conversationId = ingested.conversationId
    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    const visitorPrincipalId = conv.visitorPrincipalId

    await asWorkspace(async () => {
      autoAck.enabled = true
      expect(
        await maybeSendColdInboundAck({
          parsed: coldEmail,
          conversationId,
          conversationSubject: conv.subject,
        })
      ).toBe('sent')
      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'Sorry about that, I have corrected the invoice.',
        agentName: 'Alex',
        channel: 'email',
      })
      await notifyCsatRequestEmail(conversationId, 'How did we do?')
      await testDb
        .update(conversations)
        .set({ status: 'closed', resolvedAt: new Date(), endReason: 'resolved' })
        .where(eq(conversations.id, conversationId))
      await notifyConversationClosed({
        conversationId,
        variant: 'closed',
        closerPrincipalId: agent,
      })
    })

    const mails = customerMail()
    expect(mails.map((m) => m.get('from'))).toEqual([
      'Example Support <help@home.example>',
      'Alex from Example Support <help@home.example>',
      'Example Support <help@home.example>',
      'Example Support <help@home.example>',
    ])
    expect(new Set(mails.map((m) => m.get('subject')))).toEqual(new Set(['Re: Help with billing']))
    // Every one answers the customer's message and replies on the conversation.
    for (const mail of mails) {
      expect(bareId(mail.get('in-reply-to'))).toBe(CUSTOMER_MESSAGE_ID)
      expect(referenceIds(mail)).toContain(CUSTOMER_MESSAGE_ID)
      expect(bareFrom(mail.get('reply-to')).endsWith(`@${INBOUND_DOMAIN}`)).toBe(true)
    }
    expect(new Set(mails.map((m) => m.get('reply-to'))).size).toBe(1)
    // One References chain: each mail carries every one sent before it.
    const ids = mails.map((m) => bareId(m.get('message-id')))
    expect(new Set(ids).size).toBe(4)
    for (let i = 1; i < mails.length; i++) {
      expect(referenceIds(mails[i])).toEqual(expect.arrayContaining(ids.slice(0, i)))
    }

    // A reply to the rating request lands in the closed conversation without
    // reopening it; a reply to the closing notice reopens it as usual.
    const replyTo = (parent: Map<string, string>, n: number): ParsedInboundEmail => ({
      ...coldEmail,
      toAddresses: [bareFrom(parent.get('reply-to'))],
      subject: 'Re: Help with billing',
      text: `Thanks ${n}`,
      messageId: `<reply-${n}@example.org>`,
      inReplyTo: parent.get('message-id') ?? null,
      references: [parent.get('message-id') ?? ''],
    })
    const statusNow = async () =>
      (
        await testDb
          .select({ status: conversations.status })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
      )[0]?.status
    expect((await asWorkspace(() => ingestParsedEmail(replyTo(mails[2], 1)))).status).toBe(
      'ingested'
    )
    expect(await statusNow()).toBe('closed')
    expect((await asWorkspace(() => ingestParsedEmail(replyTo(mails[3], 2)))).status).toBe(
      'ingested'
    )
    expect(await statusNow()).toBe('open')

    // Support is pointed at another address, which a new thread would use, and
    // the conversation is reassigned.
    await setEmailSender('support', { mode: 'address', channelAccountId: billingAddress.id })
    expect(await asWorkspace(() => resolveSendingAddress(billing.id))).toBe('billing@home.example')
    await testDb
      .update(conversations)
      .set({ assignedTeamId: billing.id, status: 'open', resolvedAt: null, endReason: null })
      .where(eq(conversations.id, conversationId))
    received.length = 0

    await asWorkspace(() =>
      notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'Billing here, picking this up.',
        agentName: 'Sam',
        channel: 'email',
      })
    )

    const [afterMove] = customerMail()
    expect(afterMove.get('from')).toBe('Sam from Example Support <help@home.example>')
    expect(bareFrom(afterMove.get('from'))).toBe(bareFrom(mails[0].get('from')))
    expect(referenceIds(afterMove)).toEqual(expect.arrayContaining(ids))
  })
})
