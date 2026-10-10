import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { ParsedInboundEmail } from '../conversation.email-inbound'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  getEmailAutoAck: vi.fn(async () => ({ enabled: true })),
  incrementBucket: vi.fn(async (..._args: unknown[]) => ({ count: 1 })),
  enforceEmailBudget: vi.fn(async () => undefined),
  sendConversationAutoAckEmail: vi.fn(async (_opts?: unknown) => ({
    sent: true,
    messageId: 'ack@x',
  })),
  recordOutboundEmail: vi.fn(async (..._args: unknown[]) => undefined),
  requireSettings: vi.fn(async () => ({ name: 'Acme' })),
  inboundReplyToAddress: vi.fn(() => 'reply+c1@mail.example'),
  mintOutboundMessageId: vi.fn(() => 'c.1.ack@mail.example'),
}))

vi.mock('@/lib/server/domains/settings/settings.email-auto-ack', () => ({
  getEmailAutoAck: () => hoisted.getEmailAutoAck(),
}))

vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => hoisted.incrementBucket(...args),
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceEmailBudget: () => hoisted.enforceEmailBudget(),
  emailBudgetAvailable: async () => {
    try {
      await hoisted.enforceEmailBudget()
      return true
    } catch {
      return false
    }
  },
}))

vi.mock('@quackback/email', () => ({
  sendConversationAutoAckEmail: (opts: unknown) => hoisted.sendConversationAutoAckEmail(opts),
}))

vi.mock('../conversation.email-store', () => ({
  recordOutboundEmail: (...args: unknown[]) => hoisted.recordOutboundEmail(...args),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettings: () => hoisted.requireSettings(),
}))

vi.mock('../conversation.email-channel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversation.email-channel')>()
  return {
    ...actual,
    inboundReplyToAddress: () => hoisted.inboundReplyToAddress(),
    mintOutboundMessageId: () => hoisted.mintOutboundMessageId(),
    ownEmailDomains: () => new Set(['acme.com']),
  }
})

import { evaluateAutoAckGuards, maybeSendColdInboundAck } from '../conversation.auto-ack'

function parsed(over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail {
  return {
    from: 'Priya <priya@customer.com>',
    toAddresses: ['support@acme.com'],
    ccAddresses: [],
    replyToAddresses: [],
    subject: 'Help',
    text: 'Hi',
    html: undefined,
    messageId: 'cust@x',
    emailId: null,
    inReplyTo: null,
    references: [],
    autoSubmitted: null,
    autoResponseSuppress: null,
    precedence: null,
    hasListHeaders: false,
    authenticationResults: null,
    ...over,
  }
}

const conversationId = 'conversation_1' as ConversationId

describe('evaluateAutoAckGuards', () => {
  it('allows a normal customer message', () => {
    expect(evaluateAutoAckGuards(parsed(), { EMAIL_FROM: 'noreply@acme.com' })).toBeNull()
  })

  it('suppresses auto-submitted, bulk, list, and own-domain mail', () => {
    expect(evaluateAutoAckGuards(parsed({ autoSubmitted: 'auto-replied' }))).toBe('auto_submitted')
    expect(evaluateAutoAckGuards(parsed({ precedence: 'bulk' }))).toBe('precedence')
    expect(evaluateAutoAckGuards(parsed({ hasListHeaders: true }))).toBe('list')
    expect(
      evaluateAutoAckGuards(parsed({ from: 'bot@acme.com' }), { EMAIL_FROM: 'noreply@acme.com' })
    ).toBe('own_domain')
  })
})

describe('maybeSendColdInboundAck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.getEmailAutoAck.mockResolvedValue({ enabled: true })
    hoisted.incrementBucket.mockResolvedValue({ count: 1 })
    hoisted.enforceEmailBudget.mockResolvedValue(undefined)
    hoisted.sendConversationAutoAckEmail.mockResolvedValue({ sent: true, messageId: 'ack@x' })
  })

  it('does not send when the setting is off', async () => {
    hoisted.getEmailAutoAck.mockResolvedValueOnce({ enabled: false })
    await expect(
      maybeSendColdInboundAck({
        parsed: parsed(),
        conversationId,
        conversationSubject: 'Help',
      })
    ).resolves.toBe('disabled')
    expect(hoisted.sendConversationAutoAckEmail).not.toHaveBeenCalled()
  })

  it('does not send when a loop guard fires', async () => {
    await expect(
      maybeSendColdInboundAck({
        parsed: parsed({ autoSubmitted: 'auto-replied' }),
        conversationId,
        conversationSubject: 'Help',
      })
    ).resolves.toBe('auto_submitted')
    expect(hoisted.sendConversationAutoAckEmail).not.toHaveBeenCalled()
  })

  it('does not send when the sender is rate-capped', async () => {
    hoisted.incrementBucket.mockResolvedValueOnce({ count: 3 })
    await expect(
      maybeSendColdInboundAck({
        parsed: parsed(),
        conversationId,
        conversationSubject: 'Help',
      })
    ).resolves.toBe('rate_capped')
    expect(hoisted.sendConversationAutoAckEmail).not.toHaveBeenCalled()
  })

  it('still sends when the monthly broadcast budget is exhausted', async () => {
    hoisted.enforceEmailBudget.mockRejectedValueOnce(
      new TierLimitError({ limit: 'emailsPerMonth', message: 'Email budget exhausted' })
    )
    await expect(
      maybeSendColdInboundAck({
        parsed: parsed(),
        conversationId,
        conversationSubject: 'Help',
      })
    ).resolves.toBe('sent')
    expect(hoisted.sendConversationAutoAckEmail).toHaveBeenCalled()
  })

  it('sends with conversationId and records the outbound id', async () => {
    await expect(
      maybeSendColdInboundAck({
        parsed: parsed(),
        conversationId,
        conversationSubject: 'Billing',
      })
    ).resolves.toBe('sent')

    expect(hoisted.sendConversationAutoAckEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        conversationSubject: 'Billing',
        workspaceName: 'Acme',
        inReplyTo: 'cust@x',
        messageId: 'c.1.ack@mail.example',
      })
    )
    expect(hoisted.recordOutboundEmail).toHaveBeenCalledWith('ack@x', conversationId)
  })
})
