/**
 * Inbound email ingestion: route a verified `email.received` event into the
 * conversation named by its plus-address, append the visitor's stripped reply
 * via the normal visitor-message path, and treat a redelivered Message-ID as a
 * no-op (idempotency). Drops payloads it can't route rather than throwing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inboundReplyToAddress, inboundTicketReplyToAddress } from '../conversation.email-channel'
import { NotFoundError } from '@/lib/shared/errors'

// Inbound signing must be configured for the plus-address to verify (the real,
// un-mocked conversation.email-channel signs + checks the conversation id).
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='
// Every inbound address names the workspace it belongs to, so the fixtures do too.
const SLUG = 'ws-t1'
const REPLY_TO = inboundReplyToAddress('conversation_abc', SLUG)!

const sendVisitorMessage = vi.fn()
const assertConversationSendRate = vi.fn()
const assertColdInboundRate = vi.fn()
const getReceivedEmail =
  vi.fn<(...a: unknown[]) => Promise<{ text: string | null; html: string | null } | null>>()
const resolveConversationByMessageIds = vi.fn<(...a: unknown[]) => Promise<string | null>>()
const resolvePrincipalIdByEmail = vi.fn<(...a: unknown[]) => Promise<string | null>>()
const uploadImageBuffer = vi.fn()
const uploadObject = vi.fn()
// Ticket reply branch (D9) seams: the ticket load + the requester-reply append
// core are mocked (the append core is exercised for real in the tickets domain's
// requester.service.test.ts); the cold-inbound channel resolver is spied so a
// ticket mail can be PROVEN never to fall through to cold inbound.
const loadTicketOr404 = vi.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>()
const appendInboundTicketReply = vi.fn()
const resolveChannelAccountByRecipient = vi.fn()
// The workspace's own address is a front door that needs no row, so cold inbound
// asks for it when no row matched. Spied rather than left real: this file's db is
// a fake, and what these cases are about is which question was asked with which
// recipients, not what a row lookup would have answered.
const ensurePlatformInboundRoute = vi.fn<(...a: unknown[]) => Promise<unknown>>()
// The cold-inbound create path: sender resolution mints a lead row and the
// conversation insert writes several tables, neither of which this file's fake
// db stands in for. What it stores is pinned against a real database in
// email-cold-inbound-ingest.test.ts; here the seam only has to let a message
// REACH that path, so the drops and hand-offs before it can be asserted.
const resolveColdInboundSender = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const createEmailConversation = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const cleanupColdInboundLead = vi.fn<(...a: unknown[]) => Promise<unknown>>()
let conversationRow: Record<string, unknown> | undefined
let principalRow: Record<string, unknown> | undefined
let userRow: Record<string, unknown> | undefined
/**
 * The rows the fake db holds for the dedupe query, and the keys it was asked
 * for.
 *
 * KEYED, NOT CONSTANT, and that is load-bearing. A `where` that returns the same
 * rows whatever it was handed answers every possible key identically, so a test
 * claiming "this message deduplicated on X" passes just as happily against code
 * that looked X up, code that looked something else up, and code that ran the
 * query with no key at all. The fake therefore answers only the key the query
 * actually bound, which is the one behaviour of a real index that these tests
 * depend on.
 */
let dupeRowsByKey = new Map<string, Array<Record<string, unknown>>>()
/** Every dedupe key the ingest core bound, in order. */
let dedupeKeysQueried: string[] = []

/**
 * The string values a drizzle `sql` fragment bound as parameters.
 *
 * A template's chunks are its literal pieces plus the interpolated values; the
 * interpolated ones are the primitives, which for the dedupe query is the single
 * key it compares against.
 */
function boundParams(clause: unknown): string[] {
  const chunks = (clause as { queryChunks?: unknown[] } | null)?.queryChunks ?? []
  return chunks.filter((chunk): chunk is string => typeof chunk === 'string')
}

vi.mock('../conversation.email-store', () => ({
  resolveConversationByMessageIds: (...a: unknown[]) => resolveConversationByMessageIds(...a),
  resolvePrincipalIdByEmail: (...a: unknown[]) => resolvePrincipalIdByEmail(...a),
}))

vi.mock('../conversation.service', () => ({
  sendVisitorMessage: (...a: unknown[]) => sendVisitorMessage(...a),
}))

vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  getReceivedEmail: (...a: unknown[]) => getReceivedEmail(...a),
}))

// No importOriginal spread: this factory REPLACES the module, so every export
// the ingest path calls has to be listed here or it is undefined at call time.
vi.mock('../conversation.ratelimit', () => ({
  assertConversationSendRate: (...a: unknown[]) => assertConversationSendRate(...a),
  assertColdInboundRate: (...a: unknown[]) => assertColdInboundRate(...a),
  ConversationRateLimitError: class ConversationRateLimitError extends Error {
    readonly code = 'RATE_LIMITED'
    readonly retryAfter = 5
  },
}))

// Spread the real db module (so every table export — including ones the email
// pipeline added later, like channelAccounts — is present) and override ONLY
// the `db` handle. Re-listing tables here is the banned pattern that broke when
// channelAccounts landed; the operators/tables the code touches are ignored by
// the custom select chain anyway.
vi.mock('@/lib/server/db', async (importOriginal) => {
  let asked: string | null = null
  const selectChain = {
    from: () => selectChain,
    where: (clause: unknown) => {
      // Recorded rather than ignored: the key the code chose is the thing under
      // test everywhere dedupe is asserted.
      asked = boundParams(clause)[0] ?? null
      if (asked !== null) dedupeKeysQueried.push(asked)
      return selectChain
    },
    limit: async () => (asked === null ? [] : (dupeRowsByKey.get(asked) ?? [])),
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      query: {
        conversations: { findFirst: async () => conversationRow },
        principal: { findFirst: async () => principalRow },
        user: { findFirst: async () => userRow },
      },
      select: () => selectChain,
    },
  }
})

// Storage is mocked so rehosting inbound media never touches real S3; the mock
// returns own-storage URLs (BASE_URL/api/storage/...) so they read as trusted.
// generateStorageKey + MAX_FILE_SIZE stay real via the spread.
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  isS3Usable: () => true,
  uploadImageBuffer: (...a: unknown[]) => uploadImageBuffer(...a),
  uploadObject: (...a: unknown[]) => uploadObject(...a),
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  loadTicketOr404: (...a: unknown[]) => loadTicketOr404(...a),
}))

vi.mock('@/lib/server/domains/tickets/requester.service', () => ({
  appendInboundTicketReply: (...a: unknown[]) => appendInboundTicketReply(...a),
}))

// Only the two functions that read or write rows are spied. `addressesPlatformInbox`
// stays REAL through the spread: it is a pure reading of the address grammar with
// no database in it, and a stub would get to decide by itself which recipients
// count as this workspace's own address — which is the question these cases are
// asserting an answer to.
vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/channel-accounts/channel-account.service')>()),
  resolveChannelAccountByRecipient: (...a: unknown[]) => resolveChannelAccountByRecipient(...a),
  ensurePlatformInboundRoute: (...a: unknown[]) => ensurePlatformInboundRoute(...a),
}))

vi.mock('../conversation.email-cold-inbound', async (orig) => ({
  ...(await orig<typeof import('../conversation.email-cold-inbound')>()),
  resolveColdInboundSender: (...a: unknown[]) => resolveColdInboundSender(...a),
  createEmailConversation: (...a: unknown[]) => createEmailConversation(...a),
  cleanupColdInboundLead: (...a: unknown[]) => cleanupColdInboundLead(...a),
}))

// Which workspace this process is serving. Real in production (workspace scope
// on a fleet, a fixed label self-hosted); pinned here to the label the fixtures
// mint under, so the loop guard is asking the question it asks in the running
// system rather than one that can never be answered yes.
vi.mock('../conversation.mail-slug', () => ({
  SELF_HOSTED_MAIL_SLUG: 'reply',
  currentMailSlug: () => SLUG,
}))

import { ingestInboundEmail, ingestParsedEmail } from '../conversation.email-inbound.service'
import { evaluateInboundAuth } from '../email-auth'
import { parseRawEmail } from '../conversation.email-inbound'
import type { ParsedInboundEmail, ParsedEmailAttachment } from '../conversation.email-inbound'

const baseEvent = {
  type: 'email.received',
  data: {
    to: [REPLY_TO],
    from: 'jane@example.com',
    subject: 'Re: ticket',
    text: 'This is my reply.\n\nOn Mon wrote:\n> old',
    headers: [{ name: 'Message-ID', value: '<m-1@x>' }],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  conversationRow = { id: 'conversation_abc', visitorPrincipalId: 'principal_v', status: 'closed' }
  // contactEmail matches baseEvent's From — sender verification must hold for
  // the happy-path tests.
  principalRow = {
    id: 'principal_v',
    type: 'anonymous',
    displayName: 'Jane',
    contactEmail: 'jane@example.com',
    userId: null,
  }
  userRow = undefined
  dupeRowsByKey = new Map()
  dedupeKeysQueried = []
  sendVisitorMessage.mockResolvedValue({ created: false })
  assertConversationSendRate.mockResolvedValue(undefined)
  getReceivedEmail.mockResolvedValue(null)
  resolveConversationByMessageIds.mockResolvedValue(null)
  resolvePrincipalIdByEmail.mockResolvedValue(null)
  // No route materialises unless a case says so, which is what makes the drops
  // below real drops. The predicate that decides whether one is even asked for
  // is the real one, so a message not addressed to this workspace never gets
  // this far.
  ensurePlatformInboundRoute.mockResolvedValue(null)
  // The verdict is the REAL evaluation of the message's own
  // Authentication-Results, because the spam-signal layer downstream reads it
  // and a hardcoded verdict would decide that layer's behaviour by fiat.
  resolveColdInboundSender.mockImplementation(async (_from, authResults) => ({
    action: 'attach',
    principalId: 'principal_lead',
    unverified: false,
    verdict: evaluateInboundAuth(authResults as string | null),
  }))
  createEmailConversation.mockResolvedValue('conversation_cold')
  cleanupColdInboundLead.mockResolvedValue(undefined)
  uploadImageBuffer.mockImplementation(async (bytes: Buffer, mime: string) => ({
    url: `https://quackback.ngrok.app/api/storage/chat-images/img-${bytes.length}.${mime.split('/')[1]}`,
  }))
  uploadObject.mockImplementation(
    async (key: string) => `https://quackback.ngrok.app/api/storage/${key}`
  )
})

describe('ingestInboundEmail', () => {
  it('appends the stripped reply as a visitor message into the matched conversation', async () => {
    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(sendVisitorMessage).toHaveBeenCalledTimes(1)
    const [input, author, actor] = sendVisitorMessage.mock.calls[0]
    expect(input).toMatchObject({
      conversationId: 'conversation_abc',
      content: 'This is my reply.',
      metadata: { source: 'email', emailMessageId: '<m-1@x>' },
    })
    expect(author).toMatchObject({ principalId: 'principal_v', displayName: 'Jane' })
    expect(actor).toMatchObject({ principalId: 'principal_v', principalType: 'anonymous' })
  })

  it('is a no-op for a redelivered Message-ID (idempotency)', async () => {
    dupeRowsByKey.set('<m-1@x>', [{ id: 'conversation_msg_existing' }])

    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'duplicate' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
    // The message's own id, unprefixed: that is what every row ingested before
    // the transport fallback existed is filed under.
    expect(dedupeKeysQueried).toEqual(['<m-1@x>'])
  })

  // Resend's `email.received` webhook is metadata-only (#320): the body must be
  // fetched from the Received Emails API when the payload carries no text/html.
  it('fetches the body from the Received Emails API when the payload is metadata-only (#320)', async () => {
    getReceivedEmail.mockResolvedValueOnce({
      text: 'Fetched reply.\n\nOn Mon wrote:\n> old',
      html: null,
    })

    const result = await ingestInboundEmail({
      type: 'email.received',
      data: {
        to: [REPLY_TO],
        from: 'jane@example.com',
        subject: 'Re: ticket',
        email_id: 'em_123',
        headers: [{ name: 'Message-ID', value: '<m-fetch@x>' }],
      },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(getReceivedEmail).toHaveBeenCalledWith('em_123')
    const [input] = sendVisitorMessage.mock.calls[0]
    expect(input).toMatchObject({
      content: 'Fetched reply.',
      metadata: { source: 'email', emailMessageId: '<m-fetch@x>' },
    })
  })

  it('falls back to the html body when the fetched email has no plain text', async () => {
    getReceivedEmail.mockResolvedValueOnce({ text: null, html: '<p>Hello from html</p>' })

    const result = await ingestInboundEmail({
      type: 'email.received',
      data: { to: [REPLY_TO], from: 'jane@example.com', email_id: 'em_html' },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    const [input] = sendVisitorMessage.mock.calls[0]
    expect(input).toMatchObject({ content: 'Hello from html' })
  })

  it('does not call the Received Emails API when the payload carries inline text', async () => {
    await ingestInboundEmail(baseEvent)

    expect(getReceivedEmail).not.toHaveBeenCalled()
  })

  it('drops as empty when the received email cannot be found', async () => {
    getReceivedEmail.mockResolvedValueOnce(null)

    const result = await ingestInboundEmail({
      type: 'email.received',
      data: { to: [REPLY_TO], from: 'jane@example.com', email_id: 'em_gone' },
    })

    expect(result).toEqual({ status: 'empty' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('propagates a transient Received Emails API failure so the delivery is retried', async () => {
    getReceivedEmail.mockRejectedValueOnce(
      new Error('received-email fetch failed: internal_server_error')
    )

    await expect(
      ingestInboundEmail({
        type: 'email.received',
        data: { to: [REPLY_TO], from: 'jane@example.com', email_id: 'em_err' },
      })
    ).rejects.toThrow('received-email fetch failed')

    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops a payload whose recipients have no plus-address', async () => {
    const result = await ingestInboundEmail({
      type: 'email.received',
      data: { to: ['support@tenaevexeo.resend.app'], text: 'hi' },
    })

    expect(result).toEqual({ status: 'no_conversation' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops when the addressed conversation no longer exists', async () => {
    conversationRow = undefined

    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'no_conversation' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops a reply that is empty after stripping quoted history', async () => {
    const result = await ingestInboundEmail({
      type: 'email.received',
      data: {
        to: [REPLY_TO],
        text: 'On Mon wrote:\n> only quoted text',
        headers: [{ name: 'Message-ID', value: '<m-2@x>' }],
      },
    })

    expect(result).toEqual({ status: 'empty' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('rejects a forged (unsigned / wrong-signature) plus-address', async () => {
    const result = await ingestInboundEmail({
      type: 'email.received',
      data: {
        to: ['reply+conversation_abc@tenaevexeo.resend.app'],
        text: 'injected as the visitor',
        headers: [{ name: 'Message-ID', value: '<m-3@x>' }],
      },
    })

    expect(result).toEqual({ status: 'no_conversation' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops a reply whose From matches no known address for the visitor', async () => {
    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'attacker@evil.example' },
    })

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops a payload with no From at all', async () => {
    const data: Record<string, unknown> = { ...baseEvent.data }
    delete data.from
    const result = await ingestInboundEmail({ ...baseEvent, data })

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('accepts a name-addr From matching the contact email case-insensitively', async () => {
    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'Jane Visitor <JANE@Example.com>' },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
  })

  it('matches the linked account email for an identified visitor', async () => {
    principalRow = {
      id: 'principal_v',
      type: 'user',
      displayName: 'Jane',
      contactEmail: null,
      userId: 'user_1',
    }
    userRow = { id: 'user_1', email: 'jane@corp.example' }

    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'jane@corp.example' },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
  })

  it('matches the captured pre-chat email on the conversation', async () => {
    principalRow = { ...principalRow!, contactEmail: null }
    conversationRow = { ...conversationRow!, visitorEmail: 'prechat@example.com' }

    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'prechat@example.com' },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
  })

  it('never matches a synthetic anonymous placeholder address', async () => {
    principalRow = { ...principalRow!, contactEmail: null }
    conversationRow = { ...conversationRow!, visitorEmail: 'temp-abc@anon.quackback.io' }

    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'temp-abc@anon.quackback.io' },
    })

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('drops every sender when the visitor has no address on file', async () => {
    principalRow = { ...principalRow!, contactEmail: null }

    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('rate-limits the inbound path (acks without fanning out a message)', async () => {
    const { ConversationRateLimitError } = await import('../conversation.ratelimit')
    assertConversationSendRate.mockRejectedValueOnce(new ConversationRateLimitError(5))

    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'rate_limited' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  describe('HTML → contentJson conversion', () => {
    it('stores the converted body + contentJson for an HTML-only email (placeholder gone)', async () => {
      const result = await ingestInboundEmail({
        type: 'email.received',
        data: {
          to: [REPLY_TO],
          from: 'jane@example.com',
          subject: 'Re: ticket',
          html: '<div dir="ltr">Hello from <b>html</b>.</div>',
          headers: [{ name: 'Message-ID', value: '<html-1@x>' }],
        },
      })

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      const [input, , , contentJson] = sendVisitorMessage.mock.calls[0]
      // Placeholder replaced by the real converted text.
      expect((input as { content: string }).content).toBe('Hello from html.')
      expect((input as { content: string }).content).not.toContain('no plain-text body')
      // Rich doc passed as the 4th arg, formatting intact.
      expect(contentJson).not.toBeNull()
      const json = JSON.stringify(contentJson)
      expect(json).toContain('"bold"')
      expect(json).toContain('html')
    })

    it('keeps text/plain precedence for content but still derives contentJson from the HTML', async () => {
      const result = await ingestInboundEmail({
        type: 'email.received',
        data: {
          to: [REPLY_TO],
          from: 'jane@example.com',
          text: 'My typed reply.\n\nOn Mon wrote:\n> quoted',
          html: '<div dir="ltr">My typed reply.</div>',
          headers: [{ name: 'Message-ID', value: '<both-1@x>' }],
        },
      })

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      const [input, , , contentJson] = sendVisitorMessage.mock.calls[0]
      // text/plain (quote-trimmed) wins the plaintext mirror.
      expect((input as { content: string }).content).toBe('My typed reply.')
      // …but the rich doc still comes from the HTML part.
      expect(contentJson).not.toBeNull()
      expect(JSON.stringify(contentJson)).toContain('My typed reply.')
    })

    it('passes a null contentJson for a plaintext-only email (unchanged behavior)', async () => {
      const result = await ingestInboundEmail(baseEvent)

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      const [input, , , contentJson] = sendVisitorMessage.mock.calls[0]
      expect((input as { content: string }).content).toBe('This is my reply.')
      expect(contentJson ?? null).toBeNull()
    })

    it('falls back to the placeholder when an HTML-only body converts to empty', async () => {
      const result = await ingestInboundEmail({
        type: 'email.received',
        data: {
          to: [REPLY_TO],
          from: 'jane@example.com',
          html: '<script>alert(1)</script>',
          headers: [{ name: 'Message-ID', value: '<empty-html@x>' }],
        },
      })

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      const [input, , , contentJson] = sendVisitorMessage.mock.calls[0]
      expect((input as { content: string }).content).toBe('(no plain-text body)')
      expect(contentJson ?? null).toBeNull()
    })
  })

  describe('loop / auto-mail suppression', () => {
    it('drops an Auto-Submitted (autoresponder) message before routing', async () => {
      const result = await ingestInboundEmail({
        ...baseEvent,
        data: {
          ...baseEvent.data,
          headers: [...baseEvent.data.headers, { name: 'Auto-Submitted', value: 'auto-replied' }],
        },
      })

      expect(result).toEqual({ status: 'suppressed' })
      expect(sendVisitorMessage).not.toHaveBeenCalled()
    })

    it('drops bulk (Precedence) mail', async () => {
      const result = await ingestInboundEmail({
        ...baseEvent,
        data: {
          ...baseEvent.data,
          headers: [...baseEvent.data.headers, { name: 'Precedence', value: 'bulk' }],
        },
      })

      expect(result).toEqual({ status: 'suppressed' })
    })

    it('drops our own mail looping back (Message-ID on our own domain)', async () => {
      // EMAIL_INBOUND_DOMAIN is one of our own domains; a Message-ID on it is a loop.
      const result = await ingestInboundEmail({
        ...baseEvent,
        data: {
          ...baseEvent.data,
          headers: [{ name: 'Message-ID', value: '<loop-1@tenaevexeo.resend.app>' }],
        },
      })

      expect(result).toEqual({ status: 'suppressed' })
    })

    it('does not append our own mail returning with a reply address we minted', async () => {
      // Our own notification, bounced back into the conversation's own reply
      // address by a forwarding rule at the far end. The id on the wire is the
      // FORWARDER's, which says nothing about who wrote the message; the reply
      // address we minted and put on it ourselves is what is left.
      //
      // Everything else about this message says "append me": it is addressed to
      // a plus-address that verifies, and it comes from an address this
      // conversation's visitor is known by. Strip the reply-address signal and
      // it lands in the thread, which is what makes the assertions below about
      // the signal rather than about the fixture.
      //
      // Not appended, and not destroyed either: the signal is a guess about a
      // header any sender controls, so the message is offered to the retention
      // path. What retention actually stores is pinned against a real database
      // in email-cold-inbound-ingest.test.ts.
      const result = await ingestInboundEmail({
        type: 'email.received',
        data: {
          to: [REPLY_TO],
          from: 'jane@example.com',
          subject: 'New reply from Acme',
          text: 'An agent replied to your conversation.',
          headers: [
            { name: 'Message-ID', value: '<20260812.041233.7f31@mx.forwarder.example>' },
            { name: 'Reply-To', value: `Acme Support <${REPLY_TO}>` },
          ],
        },
      })

      expect(sendVisitorMessage).not.toHaveBeenCalled()
      // No inbound route is mocked here, so retention has nothing to attach to.
      // The load-bearing half is that the message REACHED that path at all: a
      // refusal with nothing retained returns before any route is looked up.
      expect(resolveChannelAccountByRecipient).toHaveBeenCalled()
      expect(result).toEqual({ status: 'no_conversation' })
    })

    it('ingests a stranger whose own mail leaves through the same provider (raw rung)', async () => {
      // The case the shortcut would destroy, on the rung where it is real: the
      // raw MIME the sending provider's own delivery carries. This customer's
      // Message-ID host is character-for-character the one on our own mail,
      // because the provider stamps its region's host on every account's mail.
      // Treating that host as proof of authorship turns a loop bug into silent
      // mail loss for every one of that provider's other customers.
      const raw = [
        `To: ${REPLY_TO}`,
        'From: Billing <jane@example.com>',
        'Subject: Re: ticket',
        'Message-ID: <0100019a1f4c8e21-9f04@email.amazonses.com>',
        'Reply-To: jane@example.com',
        '',
        'Our invoice did not arrive, can you check?',
      ].join('\r\n')

      const result = await ingestParsedEmail(parseRawEmail(raw))

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      expect(sendVisitorMessage).toHaveBeenCalledTimes(1)
    })

    // The exact test, and the only one of the three that is not an inference:
    // this id is not merely shaped like one of ours, it is a row THIS workspace
    // wrote when its own mail went out. A replier's own MTA mints its own id, so
    // the only way to collide is to copy ours onto your own message.
    it('drops a message whose own Message-ID is one we recorded going out', async () => {
      // Recorded bare, as the sending provider's API reports it; arriving hosted,
      // as the header it signed carries it. The store spans the two forms, so the
      // test also pins that the guard asks the question through the store rather
      // than by matching strings itself.
      const asSent = '0100019a1f4c8e21-6b2d'
      const asItComesBack = `<${asSent}@email.amazonses.com>`
      resolveConversationByMessageIds.mockImplementation(async (...args: unknown[]) => {
        const ids = args[0] as string[]
        return ids.includes(asItComesBack) ? 'conversation_abc' : null
      })

      const result = await ingestInboundEmail({
        ...baseEvent,
        data: {
          ...baseEvent.data,
          headers: [{ name: 'Message-ID', value: asItComesBack }],
        },
      })

      expect(result).toEqual({ status: 'suppressed' })
      expect(sendVisitorMessage).not.toHaveBeenCalled()
      // A fact, so it is a hard drop: nothing is offered to retention.
      expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
      expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
      expect(resolveConversationByMessageIds).toHaveBeenCalledWith([asItComesBack])
    })

    it('asks that question of the message’s OWN id, never of the ids it quotes', async () => {
      // Every genuine reply quotes an id we recorded — that is what threading IS.
      // Reading the quoted ids as evidence of authorship would drop every reply
      // whose client kept the References chain, which is nearly all of them.
      const quoted = 'c.abc.n1@tenaevexeo.resend.app'
      resolveConversationByMessageIds.mockImplementation(async (...args: unknown[]) => {
        const ids = args[0] as string[]
        return ids.includes(quoted) ? 'conversation_abc' : null
      })

      const result = await ingestInboundEmail({
        ...baseEvent,
        data: {
          ...baseEvent.data,
          headers: [
            { name: 'Message-ID', value: '<reply-77@example.com>' },
            { name: 'In-Reply-To', value: `<${quoted}>` },
          ],
        },
      })

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      expect(sendVisitorMessage).toHaveBeenCalledTimes(1)
    })

    it('does not read a neighbouring workspace’s Message-ID as ours on a pooled fleet', async () => {
      // One process serves every workspace behind one shared sending domain, so
      // a Message-ID host is a fact about the FLEET and not about this workspace.
      // Reading it as authorship hard-drops the neighbour's mail — the same
      // mistake as trusting a sending provider's regional host, one level in.
      vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
      try {
        const neighboursOwnId = '<c.01kw8qxn1eeh4t2rek7varh032.n1@tenaevexeo.resend.app>'
        const passingThrough = await ingestInboundEmail({
          ...baseEvent,
          data: { ...baseEvent.data, headers: [{ name: 'Message-ID', value: neighboursOwnId }] },
        })
        expect(passingThrough).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })

        // …and the fleet is not left without a guard: the id this workspace
        // recorded itself still identifies its own mail coming back.
        vi.clearAllMocks()
        sendVisitorMessage.mockResolvedValue({ created: false })
        assertConversationSendRate.mockResolvedValue(undefined)
        const ourOwnId = '<0100019a1f4c8e21-4c17@email.amazonses.com>'
        resolveConversationByMessageIds.mockImplementation(async (...args: unknown[]) => {
          const ids = args[0] as string[]
          return ids.includes(ourOwnId) ? 'conversation_abc' : null
        })
        const comingBack = await ingestInboundEmail({
          ...baseEvent,
          data: { ...baseEvent.data, headers: [{ name: 'Message-ID', value: ourOwnId }] },
        })
        expect(comingBack).toEqual({ status: 'suppressed' })
        expect(sendVisitorMessage).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  describe('the workspace front door is materialised last of all', () => {
    // Mail to the workspace's own address, from a stranger it has blocked. The
    // row is the workspace permanently gaining a front door, and a stranger
    // whose message is thrown away must not be able to cause one: the write
    // belongs after every gate that can refuse the message, not before them.
    const coldEvent = (over: Record<string, unknown> = {}) => ({
      type: 'email.received',
      data: {
        to: [`${SLUG}@tenaevexeo.resend.app`],
        from: 'stranger@example.com',
        subject: 'Hello',
        text: 'Let me in.',
        headers: [{ name: 'Message-ID', value: '<cold-1@example.com>' }],
        ...over,
      },
    })

    it('asks for the route only after the sender has cleared every gate', async () => {
      const result = await ingestInboundEmail(coldEvent())

      // Nothing to bind to (the route is mocked away), so the message drops —
      // but it got as far as being resolved, which is what says the gates ran
      // first and the write was left until it was actually needed.
      expect(result).toEqual({ status: 'no_conversation' })
      expect(resolveColdInboundSender).toHaveBeenCalled()
      expect(ensurePlatformInboundRoute).toHaveBeenCalledWith([`${SLUG}@tenaevexeo.resend.app`])
      expect(createEmailConversation).not.toHaveBeenCalled()
    })

    it('creates nothing for a blocked sender', async () => {
      principalRow = { ...principalRow, blockedAt: new Date() }

      const result = await ingestInboundEmail(coldEvent())

      expect(result).toEqual({ status: 'suppressed' })
      expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
    })

    it('creates nothing for a message with no body', async () => {
      const result = await ingestInboundEmail(coldEvent({ text: '' }))

      expect(result).toEqual({ status: 'empty' })
      expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
      expect(resolveColdInboundSender).not.toHaveBeenCalled()
    })

    it('creates nothing for mail addressed to somebody else entirely', async () => {
      // The cheap half stays cheap: a message that is not ours is refused on the
      // address grammar alone, before a single row is read or written.
      const result = await ingestInboundEmail(coldEvent({ to: ['nobody@elsewhere.example'] }))

      expect(result).toEqual({ status: 'no_conversation' })
      expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
      expect(resolveColdInboundSender).not.toHaveBeenCalled()
    })
  })

  describe('References fallback (plus-address stripped)', () => {
    const strippedEvent = {
      type: 'email.received',
      data: {
        to: ['support@tenaevexeo.resend.app'], // no plus-address
        from: 'jane@example.com',
        text: 'Following up here.',
        headers: [
          { name: 'Message-ID', value: '<reply-9@example.com>' },
          { name: 'In-Reply-To', value: '<c.abc.n1@tenaevexeo.resend.app>' },
        ],
      },
    }

    it('routes via a stored outbound Message-ID when no plus-address is present', async () => {
      // KEYED, not constant. The store is asked two different questions on this
      // path — "is this message's own id one of ours" (authorship) and "does it
      // quote one of ours" (routing) — and a double that answers both the same
      // way cannot tell the two apart, so it would pass against code that
      // confused them and dropped this reply as a loop.
      resolveConversationByMessageIds.mockImplementation(async (...args: unknown[]) => {
        const ids = args[0] as string[]
        return ids.includes('c.abc.n1@tenaevexeo.resend.app') ? 'conversation_abc' : null
      })

      const result = await ingestInboundEmail(strippedEvent)

      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      expect(resolveConversationByMessageIds).toHaveBeenCalledWith([
        'c.abc.n1@tenaevexeo.resend.app',
      ])
    })

    it('drops when neither a plus-address nor a References match resolves', async () => {
      resolveConversationByMessageIds.mockResolvedValue(null)

      const result = await ingestInboundEmail(strippedEvent)

      expect(result).toEqual({ status: 'no_conversation' })
      expect(sendVisitorMessage).not.toHaveBeenCalled()
    })
  })

  it('accepts a sender resolved to the visitor via a channel identity', async () => {
    // From matches no known address, but a channel identity maps it to the
    // conversation's visitor principal.
    principalRow = { ...principalRow!, contactEmail: null }
    resolvePrincipalIdByEmail.mockResolvedValue('principal_v')

    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'jane.alias@example.com' },
    })

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(resolvePrincipalIdByEmail).toHaveBeenCalledWith('jane.alias@example.com')
  })

  it('drops a sender whose channel identity maps to a different principal', async () => {
    principalRow = { ...principalRow!, contactEmail: null }
    resolvePrincipalIdByEmail.mockResolvedValue('principal_other')

    const result = await ingestInboundEmail({
      ...baseEvent,
      data: { ...baseEvent.data, from: 'someone.else@example.com' },
    })

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
  })

  describe('MIME attachment rehosting (P4.4)', () => {
    // Valid PNG magic bytes so the real magic-byte sniff accepts the image parts.
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ])

    const part = (over: Partial<ParsedEmailAttachment>): ParsedEmailAttachment => ({
      bytes: Buffer.from('file-bytes'),
      contentType: 'application/pdf',
      filename: 'file.pdf',
      contentId: null,
      disposition: 'attachment',
      ...over,
    })

    let seq = 0
    const reply = (over: Partial<ParsedInboundEmail>): ParsedInboundEmail => ({
      toAddresses: [REPLY_TO],
      ccAddresses: [],
      replyToAddresses: [],
      from: 'jane@example.com',
      subject: 'Re: ticket',
      text: 'reply body',
      html: undefined,
      messageId: `<att-${seq++}@example.com>`,
      emailId: null,
      inReplyTo: null,
      references: [],
      autoSubmitted: null,
      autoResponseSuppress: null,
      precedence: null,
      hasListHeaders: false,
      authenticationResults: null,
      ...over,
    })

    const lastSend = () =>
      sendVisitorMessage.mock.calls[sendVisitorMessage.mock.calls.length - 1] as [
        { attachments?: unknown[] },
        unknown,
        unknown,
        unknown,
      ]

    it('rehosts an inline cid image into the body and lands a PDF in attachments[] (raw IMAP fixture)', async () => {
      const pdf = Buffer.from('%PDF-1.4\ninvoice payload\n%%EOF')
      const raw = [
        `To: ${REPLY_TO}`,
        'From: jane@example.com',
        'Subject: Re: ticket',
        'Message-ID: <mime-att-1@example.com>',
        'Content-Type: multipart/mixed; boundary="OUT"',
        '',
        '--OUT',
        'Content-Type: multipart/alternative; boundary="ALT"',
        '',
        '--ALT',
        'Content-Type: text/plain',
        '',
        'Here is the logo and invoice.',
        '--ALT',
        'Content-Type: text/html',
        '',
        '<div dir="ltr">Here is the logo <img src="cid:logo@x"> and invoice.</div>',
        '--ALT--',
        '--OUT',
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        'Content-ID: <logo@x>',
        'Content-Disposition: inline; filename="logo.png"',
        '',
        PNG.toString('base64'),
        '--OUT',
        'Content-Type: application/pdf',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="invoice.pdf"',
        '',
        pdf.toString('base64'),
        '--OUT--',
      ].join('\r\n')

      const result = await ingestParsedEmail(parseRawEmail(raw))
      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })

      const [input, , , contentJson] = lastSend()
      // The inline image was rewritten to a rehosted https src (cid gone).
      const json = JSON.stringify(contentJson)
      expect(json).toContain('/api/storage/chat-images')
      expect(json).not.toContain('cid:')
      // The PDF is a discrete attachment carrying name/type/size + a trusted url.
      expect(input.attachments).toHaveLength(1)
      expect(input.attachments![0]).toMatchObject({
        name: 'invoice.pdf',
        contentType: 'application/pdf',
        size: pdf.length,
      })
      expect((input.attachments![0] as { url: string }).url).toContain('/api/storage/chat-files')
    })

    it('drops an oversized part but still ingests the message', async () => {
      const result = await ingestParsedEmail(
        reply({
          attachments: [part({ filename: 'big.pdf', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })],
        })
      )
      expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
      expect(lastSend()[0].attachments).toBeUndefined()
      expect(uploadObject).not.toHaveBeenCalled()
    })

    it('keeps only the first 10 of 11+ attachments', async () => {
      const parts = Array.from({ length: 12 }, (_, i) =>
        part({ filename: `f${i}.pdf`, bytes: Buffer.from(`file-${i}`) })
      )
      const result = await ingestParsedEmail(reply({ attachments: parts }))
      expect(result.status).toBe('ingested')
      expect(lastSend()[0].attachments).toHaveLength(10)
    })

    it('rejects an image part whose bytes do not match its declared type', async () => {
      const result = await ingestParsedEmail(
        reply({
          attachments: [
            part({
              contentType: 'image/png',
              filename: 'fake.png',
              bytes: Buffer.from('this is definitely not a png image payload'),
            }),
          ],
        })
      )
      expect(result.status).toBe('ingested')
      expect(lastSend()[0].attachments).toBeUndefined()
      expect(uploadImageBuffer).not.toHaveBeenCalled()
    })

    it('caps total uploads so many cid-referenced inline images cannot amplify', async () => {
      // 40 inline images, each referenced in the HTML (so none consume a discrete
      // attachment slot) — without a total-upload budget every one would upload.
      const cids = Array.from({ length: 40 }, (_, i) => `img${i}@x`)
      const html = `<div>${cids.map((c) => `<img src="cid:${c}">`).join('')}</div>`
      const parts = cids.map((c) =>
        part({
          contentType: 'image/png',
          filename: `${c}.png`,
          contentId: c,
          disposition: 'inline',
          bytes: PNG,
        })
      )
      const result = await ingestParsedEmail(reply({ html, attachments: parts }))
      expect(result.status).toBe('ingested')
      // Bounded by MAX_INBOUND_UPLOADS (25), never all 40.
      expect(uploadImageBuffer.mock.calls.length).toBeLessThanOrEqual(25)
    })

    it('carries a cid image NOT referenced in the html as a discrete attachment', async () => {
      const result = await ingestParsedEmail(
        reply({
          html: '<p>no inline image here</p>',
          attachments: [
            part({
              contentType: 'image/png',
              filename: 'orphan.png',
              contentId: 'orphan@x',
              disposition: 'inline',
              bytes: PNG,
            }),
          ],
        })
      )
      expect(result.status).toBe('ingested')
      const [input, , , contentJson] = lastSend()
      expect(input.attachments).toHaveLength(1)
      expect(input.attachments![0]).toMatchObject({ name: 'orphan.png', contentType: 'image/png' })
      // It did NOT get inlined into the body.
      expect(JSON.stringify(contentJson)).not.toContain('/api/storage/chat-images')
      expect(uploadImageBuffer).toHaveBeenCalledTimes(1)
    })
  })
})

/**
 * The lead a cold message mints, when nothing keeps the message.
 *
 * Sender resolution can MINT a person: a stranger writing in for the first time
 * becomes an anonymous lead before there is a conversation to hang them on. Two
 * ways out of the create path leave no conversation behind — no front door to
 * bind to, and an insert that throws — and each one that forgot to take the lead
 * with it would leave a customer record for a message the workspace never saw,
 * accumulating one row per delivery from anyone who could reach the door.
 *
 * Both are asserted, and separately, because they are two call sites of one
 * helper: a single case would keep passing with either of them deleted, which is
 * the whole reason the two blocks being identical is not a proof that both run.
 */
describe('the lead a discarded cold message minted', () => {
  const MINTED = 'principal_lead_minted'

  const coldEvent = (over: Record<string, unknown> = {}) => ({
    type: 'email.received',
    data: {
      to: [`${SLUG}@tenaevexeo.resend.app`],
      from: 'stranger@example.com',
      subject: 'Hello',
      text: 'Is anyone there?',
      headers: [{ name: 'Message-ID', value: '<lead-1@example.com>' }],
      ...over,
    },
  })

  beforeEach(() => {
    // A first-time sender, which is the only resolution that mints anything.
    resolveColdInboundSender.mockImplementation(async (_from, authResults) => ({
      action: 'create',
      principalId: MINTED,
      unverified: true,
      verdict: evaluateInboundAuth(authResults as string | null),
    }))
  })

  it('discards it when the message reached no front door to bind to', async () => {
    ensurePlatformInboundRoute.mockResolvedValue(null)

    const result = await ingestInboundEmail(coldEvent())

    expect(result).toEqual({ status: 'no_conversation' })
    expect(createEmailConversation).not.toHaveBeenCalled()
    expect(cleanupColdInboundLead).toHaveBeenCalledWith(MINTED)
  })

  it('discards it when the conversation insert throws', async () => {
    ensurePlatformInboundRoute.mockResolvedValue({ id: 'channel_account_1', role: 'inbound' })
    createEmailConversation.mockRejectedValueOnce(new Error('conversation insert failed'))

    // The error still propagates, so the delivery is retried rather than acked:
    // cleaning up is not the same as swallowing.
    await expect(ingestInboundEmail(coldEvent())).rejects.toThrow('conversation insert failed')
    expect(cleanupColdInboundLead).toHaveBeenCalledWith(MINTED)
  })

  it('leaves an existing person alone on the same two paths', async () => {
    // The condition inside the helper. `attach` resolved to somebody this
    // workspace already knew, and deleting them because one message could not be
    // filed would destroy a customer over a transient insert failure.
    resolveColdInboundSender.mockImplementation(async (_from, authResults) => ({
      action: 'attach',
      principalId: 'principal_known',
      unverified: false,
      verdict: evaluateInboundAuth(authResults as string | null),
    }))

    ensurePlatformInboundRoute.mockResolvedValue(null)
    expect(await ingestInboundEmail(coldEvent())).toEqual({ status: 'no_conversation' })

    ensurePlatformInboundRoute.mockResolvedValue({ id: 'channel_account_1', role: 'inbound' })
    createEmailConversation.mockRejectedValueOnce(new Error('conversation insert failed'))
    await expect(
      ingestInboundEmail(coldEvent({ headers: [{ name: 'Message-ID', value: '<lead-2@x>' }] }))
    ).rejects.toThrow('conversation insert failed')

    expect(cleanupColdInboundLead).not.toHaveBeenCalled()
  })
})

/**
 * Deduplicating a message that carries no `Message-ID` of its own.
 *
 * The edge bridge is invoked once per MESSAGE with every recipient that matched,
 * and a fault on any one of them redelivers the whole message — so a recipient
 * that already succeeded sees it twice. Dedupe keyed on the message's own header
 * has nothing to key on when the sender omitted one, and nothing upstream
 * invents one, so the redelivery lands as a second copy. The transport's id is
 * the fallback: identical on every copy of one message and stable across
 * retries.
 *
 * Every case here asserts the KEY THAT WAS LOOKED UP, not merely the outcome.
 * The fake db answers only the key the query bound (see {@link dupeRowsByKey}),
 * so an implementation that deduplicated on the wrong value — or on nothing —
 * fails rather than passing on a doubled-up double.
 */
describe('the transport id as a dedupe fallback', () => {
  const rawWith = (headers: string[]): string =>
    [
      `To: ${REPLY_TO}`,
      'From: jane@example.com',
      'Subject: Re: ticket',
      ...headers,
      '',
      'This is my reply.',
      '',
    ].join('\r\n')

  /** A parsed message with no `Message-ID`, as the transport handed it over. */
  function noMessageId(transportMessageId?: string): ParsedInboundEmail {
    const parsed = parseRawEmail(rawWith([]))
    expect(parsed.messageId).toBeNull()
    if (transportMessageId !== undefined) parsed.transportMessageId = transportMessageId
    return parsed
  }

  it('deduplicates a message with no Message-ID on the transport id', async () => {
    // The first copy lands and is FILED under the namespaced transport key...
    const first = await ingestParsedEmail(noMessageId('ses-abc-123'))
    expect(first).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    const [input] = sendVisitorMessage.mock.calls[0] as [{ metadata: { emailMessageId?: string } }]
    expect(input.metadata.emailMessageId).toBe('qb-transport:ses-abc-123')

    // ...so the redelivery finds it. Stored key and looked-up key are the same
    // derivation, which is the only reason the second copy matches the first.
    vi.clearAllMocks()
    dupeRowsByKey.set('qb-transport:ses-abc-123', [{ id: 'conversation_msg_existing' }])
    dedupeKeysQueried = []

    const second = await ingestParsedEmail(noMessageId('ses-abc-123'))

    expect(second).toEqual({ status: 'duplicate' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
    expect(dedupeKeysQueried).toEqual(['qb-transport:ses-abc-123'])
  })

  it('behaves exactly as before when no transport id was carried', async () => {
    // The other inbound front doors send no such id, and a message with neither
    // id is as undeduplicable as it has always been: no key is looked up, no key
    // is stored, and the message is ingested.
    const result = await ingestParsedEmail(noMessageId())

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(dedupeKeysQueried).toEqual([])
    const [input] = sendVisitorMessage.mock.calls[0] as [{ metadata: { emailMessageId?: string } }]
    expect(input.metadata.emailMessageId).toBeUndefined()
  })

  it('is only a fallback: a message with a Message-ID deduplicates on that', async () => {
    // The transport id rides outside the delivery signature, so anything able to
    // reach the door could rewrite it. It must never displace the identity the
    // message itself carried.
    const parsed = parseRawEmail(rawWith(['Message-ID: <real-1@example.com>']))
    parsed.transportMessageId = 'ses-abc-123'

    const result = await ingestParsedEmail(parsed)

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(dedupeKeysQueried).toEqual(['<real-1@example.com>'])
    const [input] = sendVisitorMessage.mock.calls[0] as [{ metadata: { emailMessageId?: string } }]
    expect(input.metadata.emailMessageId).toBe('<real-1@example.com>')
  })

  it('holds the transport id in its own namespace, so it cannot name a stored Message-ID', async () => {
    // Every Message-ID we have stored is visible to whoever was on the thread it
    // came from. Unprefixed, a chosen transport id equal to one of them would
    // suppress a message by matching a row it has nothing to do with.
    dupeRowsByKey.set('<real-1@example.com>', [{ id: 'conversation_msg_existing' }])

    const result = await ingestParsedEmail(noMessageId('<real-1@example.com>'))

    expect(result).toEqual({ status: 'ingested', conversationId: 'conversation_abc' })
    expect(dedupeKeysQueried).toEqual(['qb-transport:<real-1@example.com>'])
  })

  it('applies the same fallback to a cold inbound message', async () => {
    // A cold message opens a thread rather than appending to one, and a
    // redelivered copy would open a SECOND thread. Same key, same derivation.
    resolveConversationByMessageIds.mockResolvedValue(null)
    resolveChannelAccountByRecipient.mockResolvedValue({ id: 'chan_1', role: 'inbound' })
    const parsed = parseRawEmail(
      [
        'To: support@quackback.example',
        'From: stranger@example.com',
        'Subject: Hello',
        '',
        'Is anyone there?',
        '',
      ].join('\r\n')
    )
    parsed.transportMessageId = 'ses-cold-1'
    dupeRowsByKey.set('qb-transport:ses-cold-1', [{ id: 'conversation_msg_existing' }])

    const result = await ingestParsedEmail(parsed)

    expect(result).toEqual({ status: 'duplicate' })
    expect(dedupeKeysQueried).toEqual(['qb-transport:ses-cold-1'])
  })
})

// Reply-by-email into a ticket thread (D9). A signed `<slug>+t…` recipient
// routes into the ticket's requester-reply core; every rejection fails quiet and
// a ticket address can never open a conversation or fall through to cold inbound.
describe('ingestInboundEmail — ticket reply branch (D9)', () => {
  // A real TypeID: the unauthenticated ticket-marker claim is a test of the
  // exact shape the grammar mints, so a stand-in id would not be claimed at all.
  const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'
  const TICKET_REPLY_TO = inboundTicketReplyToAddress(TICKET_ID, SLUG)!

  const ticketEvent = (over: Record<string, unknown> = {}) => ({
    type: 'email.received',
    data: {
      to: [TICKET_REPLY_TO],
      from: 'jane@example.com',
      subject: 'Re: [Ticket] still broken',
      text: 'Yes, still broken.\n\nOn Mon wrote:\n> old ticket mail',
      headers: [{ name: 'Message-ID', value: '<t-1@x>' }],
      ...over,
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    dupeRowsByKey = new Map()
    dedupeKeysQueried = []
    // The requester the signed address resolves to; the From must match one of
    // its known addresses (account email → principal contact email).
    principalRow = {
      id: 'principal_req',
      type: 'anonymous',
      displayName: 'Jane',
      contactEmail: 'jane@example.com',
      userId: null,
    }
    userRow = undefined
    loadTicketOr404.mockResolvedValue({
      id: TICKET_ID,
      type: 'customer',
      requesterPrincipalId: 'principal_req',
    })
    appendInboundTicketReply.mockResolvedValue({ message: { id: 'conversation_msg_t' } })
    resolveChannelAccountByRecipient.mockResolvedValue(undefined)
    ensurePlatformInboundRoute.mockResolvedValue(null)
  })

  it('appends a verified reply through the requester-reply core, quoted history stripped', async () => {
    const result = await ingestInboundEmail(ticketEvent())

    expect(result).toEqual({ status: 'ingested_ticket', ticketId: TICKET_ID })
    expect(appendInboundTicketReply).toHaveBeenCalledTimes(1)
    const [ticketId, requesterId, input, principalType] = appendInboundTicketReply.mock.calls[0]
    expect(ticketId).toBe(TICKET_ID)
    expect(requesterId).toBe('principal_req')
    expect(input).toMatchObject({
      content: 'Yes, still broken.', // quoted history stripped
      metadata: { source: 'email', emailMessageId: '<t-1@x>' },
    })
    expect(principalType).toBe('anonymous')
    // Never routed as a conversation, never opened as cold inbound.
    expect(sendVisitorMessage).not.toHaveBeenCalled()
    expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
    expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
  })

  it("matches an identified requester's account email (case-insensitive)", async () => {
    principalRow = {
      id: 'principal_req',
      type: 'user',
      displayName: 'Jane',
      contactEmail: null,
      userId: 'user_req',
    }
    userRow = { id: 'user_req', email: 'jane@corp.example' }

    const result = await ingestInboundEmail(
      ticketEvent({
        from: 'Jane <JANE@Corp.example>',
        headers: [{ name: 'Message-ID', value: '<t-2@x>' }],
      })
    )

    expect(result).toEqual({ status: 'ingested_ticket', ticketId: TICKET_ID })
    expect(appendInboundTicketReply).toHaveBeenCalledTimes(1)
  })

  it('drops a tampered signature and never falls through to cold inbound', async () => {
    const result = await ingestInboundEmail({
      type: 'email.received',
      data: {
        to: [`${SLUG}+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@tenaevexeo.resend.app`],
        from: 'jane@example.com',
        text: 'injected as the requester',
        headers: [{ name: 'Message-ID', value: '<t-tamper@x>' }],
      },
    })

    expect(result).toEqual({ status: 'no_ticket' })
    expect(loadTicketOr404).not.toHaveBeenCalled()
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
    expect(sendVisitorMessage).not.toHaveBeenCalled()
    expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
    expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
  })

  it('drops a tampered signature that rides in Cc rather than To', async () => {
    // The claim guard read `To` while cold inbound reads To ∪ Cc, so the drop
    // and the thing it protects disagreed about what a recipient is. A forged
    // ticket address in Cc was then reinterpreted as ordinary mail to the
    // workspace address and opened a thread from whoever sent it.
    const result = await ingestInboundEmail({
      type: 'email.received',
      data: {
        to: ['someone-else@acme.com'],
        cc: [`${SLUG}+t01h455vb4pex5vsknk084sn02q.AAAAAAAAAAAAAAAAAAAAAA@tenaevexeo.resend.app`],
        from: 'jane@example.com',
        text: 'injected as the requester',
        headers: [{ name: 'Message-ID', value: '<t-tamper-cc@x>' }],
      },
    })

    expect(result).toEqual({ status: 'no_ticket' })
    expect(loadTicketOr404).not.toHaveBeenCalled()
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
    expect(sendVisitorMessage).not.toHaveBeenCalled()
    expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
    expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
  })

  it('appends a verified reply that rides in Cc, which is where a loop-in puts it', async () => {
    // The other half of reading one recipient set: a person who Cc's the ticket
    // address to bring support into a thread has written to the ticket, and the
    // signature is what says so. The sender still has to be the requester.
    const result = await ingestInboundEmail(
      ticketEvent({
        to: ['colleague@example.com'],
        cc: [TICKET_REPLY_TO],
        headers: [{ name: 'Message-ID', value: '<t-cc@x>' }],
      })
    )

    expect(result).toEqual({ status: 'ingested_ticket', ticketId: TICKET_ID })
    expect(appendInboundTicketReply).toHaveBeenCalledTimes(1)
  })

  it('drops when the sender is not the requester (never falls through to cold inbound)', async () => {
    const result = await ingestInboundEmail(
      ticketEvent({
        from: 'attacker@evil.example',
        headers: [{ name: 'Message-ID', value: '<t-3@x>' }],
      })
    )

    expect(result).toEqual({ status: 'from_mismatch' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
    expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
    expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
  })

  it('drops when the ticket is unknown or deleted', async () => {
    loadTicketOr404.mockRejectedValue(new NotFoundError('TICKET_NOT_FOUND', 'gone'))

    const result = await ingestInboundEmail(
      ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-4@x>' }] })
    )

    expect(result).toEqual({ status: 'no_ticket' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
    expect(resolveChannelAccountByRecipient).not.toHaveBeenCalled()
    expect(ensurePlatformInboundRoute).not.toHaveBeenCalled()
  })

  it('drops a non-customer ticket', async () => {
    loadTicketOr404.mockResolvedValue({
      id: TICKET_ID,
      type: 'back_office',
      requesterPrincipalId: 'principal_req',
    })

    const result = await ingestInboundEmail(
      ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-5@x>' }] })
    )

    expect(result).toEqual({ status: 'no_ticket' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
  })

  it('suppresses an auto-reply before it reaches the ticket branch', async () => {
    const result = await ingestInboundEmail(
      ticketEvent({
        headers: [
          { name: 'Message-ID', value: '<t-6@x>' },
          { name: 'Auto-Submitted', value: 'auto-replied' },
        ],
      })
    )

    expect(result).toEqual({ status: 'suppressed' })
    expect(loadTicketOr404).not.toHaveBeenCalled()
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
  })

  it('is a no-op for a redelivered Message-ID (idempotency)', async () => {
    dupeRowsByKey.set('<t-dup@x>', [{ id: 'conversation_msg_existing' }])

    const result = await ingestInboundEmail(
      ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-dup@x>' }] })
    )

    expect(result).toEqual({ status: 'duplicate' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
    expect(dedupeKeysQueried).toEqual(['<t-dup@x>'])
  })

  it('files a reply with no Message-ID under the key its redelivery will look up', async () => {
    // THE STORE, not the read. A ticket reply carrying no Message-ID of its own
    // deduplicates on the transport id, and that only works if the row is FILED
    // under the same derivation the lookup spends. A store that reverted to the
    // message's own id would write `undefined` here, the redelivery would look
    // up the transport key, find nothing, and append the reply a second time.
    const parsed = parseRawEmail(
      [
        `To: ${TICKET_REPLY_TO}`,
        'From: jane@example.com',
        'Subject: Re: [Ticket] still broken',
        '',
        'Yes, still broken.',
        '',
      ].join('\r\n')
    )
    expect(parsed.messageId).toBeNull()
    parsed.transportMessageId = 'ses-ticket-1'

    const result = await ingestParsedEmail(parsed)

    expect(result).toEqual({ status: 'ingested_ticket', ticketId: TICKET_ID })
    const [, , input] = appendInboundTicketReply.mock.calls[0] as [
      unknown,
      unknown,
      { metadata: { emailMessageId?: string } },
    ]
    expect(input.metadata.emailMessageId).toBe('qb-transport:ses-ticket-1')
    // The same key the read side asked for, which is what makes the pair hold.
    expect(dedupeKeysQueried).toEqual(['qb-transport:ses-ticket-1'])
  })

  it('files a reply that has a Message-ID under that id, unprefixed', async () => {
    // The other half: every row ingested before the fallback existed is filed
    // under the message's own id, so re-spelling it would make today's copy of a
    // redelivered message fail to match yesterday's row.
    await ingestInboundEmail(ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-9@x>' }] }))

    const [, , input] = appendInboundTicketReply.mock.calls[0] as [
      unknown,
      unknown,
      { metadata: { emailMessageId?: string } },
    ]
    expect(input.metadata.emailMessageId).toBe('<t-9@x>')
  })

  it('suppresses a reply from a blocked requester (never appends)', async () => {
    // isBlocked() reads the same principal row; a non-null blockedAt blocks it.
    principalRow = { ...(principalRow as Record<string, unknown>), blockedAt: new Date() }

    const result = await ingestInboundEmail(
      ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-blocked@x>' }] })
    )

    expect(result).toEqual({ status: 'suppressed' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
  })

  it('rate-limits a verified requester and never appends', async () => {
    const { ConversationRateLimitError } = await import('../conversation.ratelimit')
    assertConversationSendRate.mockRejectedValueOnce(new ConversationRateLimitError(5))

    const result = await ingestInboundEmail(
      ticketEvent({ headers: [{ name: 'Message-ID', value: '<t-rl@x>' }] })
    )

    expect(result).toEqual({ status: 'rate_limited' })
    expect(appendInboundTicketReply).not.toHaveBeenCalled()
  })
})
