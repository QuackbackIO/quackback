import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const sendConversationClosedEmail = vi.fn(async (_opts: unknown) => ({ sent: true }))
const enforceEmailBudget = vi.fn(async () => undefined)
const buildHookContext = vi.fn(async () => ({
  workspaceName: 'Acme',
  portalBaseUrl: 'https://acme.example.com',
  logoUrl: null,
}))
let csatRows: Array<Record<string, unknown>> = []
let limitQueue: Array<Array<Record<string, unknown>>> = []

vi.mock('@quackback/email', () => ({
  sendConversationClosedEmail: (opts: unknown) => sendConversationClosedEmail(opts),
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceEmailBudget: () => enforceEmailBudget(),
  emailBudgetAvailable: async () => {
    try {
      await enforceEmailBudget()
      return true
    } catch {
      return false
    }
  },
}))

vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: () => buildHookContext(),
}))

vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => false,
}))

vi.mock('../conversation.email-channel', () => ({
  isEmailInboundConfigured: () => false,
  inboundReplyToAddress: () => null,
  mintOutboundMessageId: () => undefined,
}))

vi.mock('../conversation.email-store', () => ({
  threadIdsForOutbound: async () => ({ inbound: [], outbound: [], merged: [] }),
  recordOutboundEmail: async () => undefined,
}))

vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', () => ({
  resolveConversationFrom: async () => null,
  formatNamedSendingAddress: (addr: string, name: string) => `"${name}" <${addr}>`,
}))

vi.mock('@/lib/server/email/email-log.sink', () => ({
  ensureEmailLogSink: () => undefined,
}))

vi.mock('../csat-email-token', () => ({
  mintCsatEmailToken: () => 'csat-token',
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.limit = async () => (limitQueue.length ? limitQueue.shift()! : [])
    c.then = (resolve: (v: unknown) => unknown) => resolve(csatRows)
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain() },
  }
})

import { notifyConversationClosed } from '../conversation.notify-closed'

beforeEach(() => {
  vi.clearAllMocks()
  csatRows = []
  limitQueue = []
  sendConversationClosedEmail.mockResolvedValue({ sent: true })
  enforceEmailBudget.mockResolvedValue(undefined)
})

describe('notifyConversationClosed', () => {
  it('sends a resolved close email for an email-channel conversation', async () => {
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Billing',
          visitorPrincipalId: 'principal_v' as PrincipalId,
          visitorEmail: 'priya@x.com',
          endReason: null,
        },
      ],
      [{ type: 'user', email: 'priya@x.com', contactEmail: null }],
    ]
    csatRows = []

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
      closerPrincipalId: 'principal_agent' as PrincipalId,
    })

    expect(sendConversationClosedEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationClosedEmail.mock.calls[0][0]).toMatchObject({
      to: 'priya@x.com',
      variant: 'closed',
      conversationSubject: 'Billing',
      conversationId: 'conversation_1',
    })
  })

  it('is invoked through the email adapter lifecycle seam', async () => {
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Billing',
          visitorPrincipalId: 'principal_v' as PrincipalId,
          visitorEmail: 'priya@x.com',
          endReason: null,
        },
      ],
      [{ type: 'user', email: 'priya@x.com', contactEmail: null }],
    ]

    const { emailAdapter } = await import('@/lib/server/domains/channels/email')
    await emailAdapter.deliverLifecycleEvent('auto_closed', {
      conversationId: 'conversation_1' as ConversationId,
      closerPrincipalId: 'principal_agent' as PrincipalId,
    })

    expect(sendConversationClosedEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationClosedEmail.mock.calls[0][0]).toMatchObject({
      variant: 'auto_closed',
      conversationId: 'conversation_1',
    })
  })

  it('skips spam-filtered conversations', async () => {
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Spam',
          visitorPrincipalId: 'principal_v',
          visitorEmail: 'a@x.com',
          endReason: 'spam',
        },
      ],
    ]

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
    })

    expect(sendConversationClosedEmail).not.toHaveBeenCalled()
  })

  it('skips when the visitor closed the thread', async () => {
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Hi',
          visitorPrincipalId: 'principal_v',
          visitorEmail: 'a@x.com',
          endReason: null,
        },
      ],
    ]

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
      closerPrincipalId: 'principal_v' as PrincipalId,
    })

    expect(sendConversationClosedEmail).not.toHaveBeenCalled()
  })

  it('omits CSAT when a request was already sent for the conversation', async () => {
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Billing',
          visitorPrincipalId: 'principal_v' as PrincipalId,
          visitorEmail: 'priya@x.com',
          endReason: null,
        },
      ],
      [{ type: 'user', email: 'priya@x.com', contactEmail: null }],
      [{ id: 'emaillog_prior' }],
    ]
    csatRows = [{ id: 'emaillog_prior' }]

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
      closerPrincipalId: 'principal_agent' as PrincipalId,
    })

    expect(sendConversationClosedEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationClosedEmail.mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation_1',
    })
    expect(
      (sendConversationClosedEmail.mock.calls[0][0] as { ratingUrls?: unknown }).ratingUrls
    ).toBeUndefined()
  })

  it('skips send when the monthly email budget is exhausted', async () => {
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    enforceEmailBudget.mockRejectedValueOnce(
      new TierLimitError({ limit: 'emailsPerMonth', message: 'Email budget exhausted' })
    )
    limitQueue = [
      [
        {
          id: 'conversation_1',
          channel: 'email',
          subject: 'Billing',
          visitorPrincipalId: 'principal_v' as PrincipalId,
          visitorEmail: 'priya@x.com',
          endReason: null,
        },
      ],
      [{ type: 'user', email: 'priya@x.com', contactEmail: null }],
    ]

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
    })

    expect(sendConversationClosedEmail).not.toHaveBeenCalled()
  })
})
