/**
 * Inbound email ingestion: route a verified `email.received` event into the
 * conversation named by its plus-address, append the visitor's stripped reply
 * via the normal visitor-message path, and treat a redelivered Message-ID as a
 * no-op (idempotency). Drops payloads it can't route rather than throwing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inboundReplyToAddress } from '../conversation.email-channel'

// Inbound signing must be configured for the plus-address to verify (the real,
// un-mocked conversation.email-channel signs + checks the conversation id).
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='
const REPLY_TO = inboundReplyToAddress('conversation_abc')!

const sendVisitorMessage = vi.fn()
const assertConversationSendRate = vi.fn()
const getReceivedEmail = vi.fn<(...a: unknown[]) => Promise<{ text: string | null; html: string | null } | null>>()
const resolveConversationByMessageIds = vi.fn<(...a: unknown[]) => Promise<string | null>>()
const resolvePrincipalIdByEmail = vi.fn<(...a: unknown[]) => Promise<string | null>>()
const uploadImageBuffer = vi.fn()
const uploadObject = vi.fn()
let conversationRow: Record<string, unknown> | undefined
let principalRow: Record<string, unknown> | undefined
let userRow: Record<string, unknown> | undefined
let dupeRows: Array<Record<string, unknown>> = []

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

vi.mock('../conversation.ratelimit', () => ({
  assertConversationSendRate: (...a: unknown[]) => assertConversationSendRate(...a),
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
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => dupeRows,
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
  isS3Configured: () => true,
  uploadImageBuffer: (...a: unknown[]) => uploadImageBuffer(...a),
  uploadObject: (...a: unknown[]) => uploadObject(...a),
}))

import { ingestInboundEmail, ingestParsedEmail } from '../conversation.email-inbound.service'
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
  dupeRows = []
  sendVisitorMessage.mockResolvedValue({ created: false })
  assertConversationSendRate.mockResolvedValue(undefined)
  getReceivedEmail.mockResolvedValue(null)
  resolveConversationByMessageIds.mockResolvedValue(null)
  resolvePrincipalIdByEmail.mockResolvedValue(null)
  uploadImageBuffer.mockImplementation(async (bytes: Buffer, mime: string) => ({
    url: `https://quackback.ngrok.app/api/storage/chat-images/img-${bytes.length}.${mime.split('/')[1]}`,
  }))
  uploadObject.mockImplementation(async (key: string) => `https://quackback.ngrok.app/api/storage/${key}`)
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
    dupeRows = [{ id: 'conversation_msg_existing' }]

    const result = await ingestInboundEmail(baseEvent)

    expect(result).toEqual({ status: 'duplicate' })
    expect(sendVisitorMessage).not.toHaveBeenCalled()
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
      resolveConversationByMessageIds.mockResolvedValue('conversation_abc')

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
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
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
        reply({ attachments: [part({ filename: 'big.pdf', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })] })
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
