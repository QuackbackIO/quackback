import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const sendConversationClosedEmail = vi.fn(async (_opts: unknown) => ({ sent: true }))
const enforceEmailBudget = vi.fn(async () => undefined)
const buildHookContext = vi.fn(async () => ({
  workspaceName: 'Acme',
  portalBaseUrl: 'https://acme.example.com',
  logoUrl: null,
}))
const isCsatAlreadyRequested = vi.fn(async (_id: unknown) => false)
const isCsatRatedOrEmailed = vi.fn(async (_id: unknown) => false)
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

vi.mock('../csat-request.service', () => ({
  isCsatAlreadyRequested: (id: unknown) => isCsatAlreadyRequested(id),
  isCsatRatedOrEmailed: (id: unknown) => isCsatRatedOrEmailed(id),
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
  isCsatAlreadyRequested.mockResolvedValue(false)
  isCsatRatedOrEmailed.mockResolvedValue(false)
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
    expect(isCsatRatedOrEmailed).toHaveBeenCalledWith('conversation_1')
    const ratingUrls = (sendConversationClosedEmail.mock.calls[0][0] as { ratingUrls?: string[] })
      .ratingUrls
    expect(ratingUrls).toHaveLength(5)
    expect(ratingUrls?.[4]).toBe('https://acme.example.com/csat?token=csat-token&rating=5')
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

  it('omits CSAT when the conversation was already asked or rated', async () => {
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
    isCsatRatedOrEmailed.mockResolvedValue(true)

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

  it('carries rating links when only an unanswered csat block sits in the thread', async () => {
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
    // The thread holds a csat block (a workflow ask), but no rating and no
    // rating email: the workflow asks are already blocked, the close email is not.
    isCsatAlreadyRequested.mockResolvedValue(true)
    isCsatRatedOrEmailed.mockResolvedValue(false)

    await notifyConversationClosed({
      conversationId: 'conversation_1' as ConversationId,
      variant: 'closed',
      closerPrincipalId: 'principal_agent' as PrincipalId,
    })

    const { ratingUrls } = sendConversationClosedEmail.mock.calls[0][0] as {
      ratingUrls?: string[]
    }
    expect(ratingUrls).toHaveLength(5)
    expect(ratingUrls?.[4]).toContain('rating=5')
  })

  it('still sends close mail when the monthly broadcast budget is exhausted', async () => {
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

    expect(sendConversationClosedEmail).toHaveBeenCalled()
  })
})
