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
const resolveConversationByMessageIds = vi.fn<(...a: unknown[]) => Promise<string | null>>()
const resolvePrincipalIdByEmail = vi.fn<(...a: unknown[]) => Promise<string | null>>()
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

vi.mock('../conversation.ratelimit', () => ({
  assertConversationSendRate: (...a: unknown[]) => assertConversationSendRate(...a),
  ConversationRateLimitError: class ConversationRateLimitError extends Error {
    readonly code = 'RATE_LIMITED'
    readonly retryAfter = 5
  },
}))

vi.mock('@/lib/server/db', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => dupeRows,
  }
  return {
    db: {
      query: {
        conversations: { findFirst: async () => conversationRow },
        principal: { findFirst: async () => principalRow },
        user: { findFirst: async () => userRow },
      },
      select: () => selectChain,
    },
    eq: vi.fn(),
    sql: Object.assign(() => ({}), { raw: () => ({}) }),
    conversationMessages: { metadata: 'metadata' },
    conversations: { id: 'id' },
    principal: { id: 'id' },
    user: { id: 'id' },
  }
})

import { ingestInboundEmail } from '../conversation.email-inbound.service'

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
  resolveConversationByMessageIds.mockResolvedValue(null)
  resolvePrincipalIdByEmail.mockResolvedValue(null)
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
})
