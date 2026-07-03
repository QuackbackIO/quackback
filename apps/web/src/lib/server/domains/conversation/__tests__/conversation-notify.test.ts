/**
 * Offline conversation notifications (conversation.notify): who gets pinged and emailed when a
 * visitor messages, when a note @-mentions a teammate, and when an agent replies
 * to an offline visitor. All three paths are fire-and-forget and must swallow
 * dependency errors rather than reject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'

// Drives the team/visitor SELECT result. notifyVisitorMessage resolves the
// `.where(...)` thenable to a team array; notifyAgentReply resolves `.limit(1)`
// to a single-row visitor array.
let teamRows: Array<Record<string, unknown>> = []
let visitorRows: Array<Record<string, unknown>> = []

const isAnyAgentOnline = vi.fn<() => Promise<boolean>>()
const isPrincipalOnline = vi.fn<(p: PrincipalId) => Promise<boolean>>()
const createNotificationsBatch = vi.fn<(input: unknown) => Promise<unknown>>()
const buildHookContext =
  vi.fn<
    () => Promise<{ workspaceName: string; portalBaseUrl: string; logoUrl: string | null } | null>
  >()
const sendConversationMessageEmail = vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>()

vi.mock('@/lib/server/realtime/presence', () => ({
  isAnyAgentOnline: (...a: []) => isAnyAgentOnline(...a),
  isPrincipalOnline: (...a: [PrincipalId]) => isPrincipalOnline(...a),
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: (...a: [unknown]) => createNotificationsBatch(...a),
}))

vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: (...a: []) => buildHookContext(...a),
}))

// notify.ts imports this dynamically inside the email branches.
vi.mock('@quackback/email', () => ({
  sendConversationMessageEmail: (...a: [Record<string, unknown>]) =>
    sendConversationMessageEmail(...a),
}))

// Outbound-email persistence (threading map + channel identities). No-op here;
// exercised in its own suite. Keeps notify's fire-and-forget path off the db.
const priorOutboundMessageIds = vi.fn<(...a: unknown[]) => Promise<string[]>>(async () => [])
const recordOutboundEmail = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {})
const recordEmailIdentity = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {})
vi.mock('../conversation.email-store', () => ({
  priorOutboundMessageIds: (...a: unknown[]) => priorOutboundMessageIds(...a),
  recordOutboundEmail: (...a: unknown[]) => recordOutboundEmail(...a),
  recordEmailIdentity: (...a: unknown[]) => recordEmailIdentity(...a),
}))

// Visitor deep links consult the portal-support gate; default to the widget
// link (portal support off) so existing expectations hold.
const isPortalSupportEnabled = vi.fn<() => Promise<boolean>>(async () => false)
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: () => isPortalSupportEnabled(),
}))

vi.mock('@/lib/server/db', () => {
  // A thenable chain. `.where()` resolves to the team rows (so a bare await on
  // the where() builder yields the array); `.limit()` resolves to the single
  // visitor row. `.then` makes the where() builder awaitable directly.
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.limit = async () => visitorRows
    c.then = (resolve: (v: unknown) => unknown) => resolve(teamRows)
    return c
  }
  return {
    db: { select: () => chain() },
    eq: vi.fn(),
    inArray: vi.fn(),
    principal: { id: 'id', userId: 'userId', role: 'role', type: 'type' },
    user: { id: 'id', email: 'email', name: 'name' },
  }
})

import { notifyVisitorMessage, notifyAgentReply } from '../conversation.notify'

const conversationId = 'conversation_1' as ConversationId
const conversation = { id: conversationId } as unknown as Conversation
const ctx = {
  workspaceName: 'Acme',
  portalBaseUrl: 'https://acme.example.com',
  logoUrl: null as string | null,
}

beforeEach(() => {
  teamRows = []
  visitorRows = []
  vi.clearAllMocks()
  // Silence the fire-and-forget warning logs.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  buildHookContext.mockResolvedValue(ctx)
  createNotificationsBatch.mockResolvedValue(undefined)
  sendConversationMessageEmail.mockResolvedValue(undefined)
})

describe('notifyVisitorMessage', () => {
  it('skips entirely (no in-app, no email) when an agent is online and it is not the first message', async () => {
    isAnyAgentOnline.mockResolvedValue(true)
    teamRows = [{ principalId: 'principal_admin', email: 'a@x.com', name: 'A' }]

    await notifyVisitorMessage({
      conversation,
      content: 'hi',
      authorName: 'Visitor',
      isFirstMessage: false,
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('creates an in-app batch but sends NO email on the first message while an agent is online', async () => {
    isAnyAgentOnline.mockResolvedValue(true)
    teamRows = [
      { principalId: 'principal_admin', email: 'a@x.com', name: 'A' },
      { principalId: 'principal_member', email: 'm@x.com', name: 'M' },
    ]

    await notifyVisitorMessage({
      conversation,
      content: 'hello team',
      authorName: 'Visitor',
      isFirstMessage: true,
    })

    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(2)
    expect(batch[0]).toMatchObject({
      principalId: 'principal_admin',
      type: 'chat_message',
      title: 'New message from Visitor',
      metadata: { conversationId },
    })
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('emails every team member with an address when no agent is online', async () => {
    isAnyAgentOnline.mockResolvedValue(false)
    teamRows = [
      { principalId: 'principal_admin', email: 'a@x.com', name: 'A' },
      { principalId: 'principal_noemail', email: null, name: 'N' },
      { principalId: 'principal_member', email: 'm@x.com', name: 'M' },
    ]

    await notifyVisitorMessage({
      conversation,
      content: 'urgent please help',
      authorName: 'Jane',
      isFirstMessage: false,
    })

    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
    // The null-email teammate is filtered out of the email fan-out.
    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(2)
    const firstEmail = sendConversationMessageEmail.mock.calls[0][0]
    expect(firstEmail).toMatchObject({
      to: 'a@x.com',
      direction: 'visitor_message',
      senderName: 'Jane',
      ctaUrl: `https://acme.example.com/admin/inbox?c=${conversationId}`,
      workspaceName: 'Acme',
    })
  })

  it('is a no-op when there are no team members', async () => {
    isAnyAgentOnline.mockResolvedValue(false)
    teamRows = []

    await notifyVisitorMessage({
      conversation,
      content: 'anyone there',
      authorName: 'Visitor',
      isFirstMessage: true,
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('swallows a thrown dependency (does not reject)', async () => {
    isAnyAgentOnline.mockRejectedValue(new Error('redis down'))

    await expect(
      notifyVisitorMessage({
        conversation,
        content: 'hi',
        authorName: 'V',
        isFirstMessage: true,
      })
    ).resolves.toBeUndefined()
    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })
})

describe('notifyAgentReply', () => {
  const visitorPrincipalId = 'principal_visitor' as PrincipalId

  it('returns early without emailing when the visitor is online', async () => {
    isPrincipalOnline.mockResolvedValue(true)
    visitorRows = [{ type: 'user', email: 'v@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'thanks for waiting',
      agentName: 'Agent',
    })

    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('prefers an identified visitor account email', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'here is your answer',
      agentName: 'Agent',
      capturedEmail: 'prechat@x.com',
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationMessageEmail.mock.calls[0][0]).toMatchObject({
      to: 'account@x.com',
      direction: 'agent_reply',
      senderName: 'Agent',
      // Token-free deep link straight to the widget's messenger view.
      ctaUrl: expect.stringContaining('https://acme.example.com/widget/?c='),
      workspaceName: 'Acme',
    })
  })

  it('falls back to the captured pre-chat email for an anonymous visitor', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    // Anonymous principals have no account email even if a row exists.
    visitorRows = [{ type: 'anonymous', email: null }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'answer',
      agentName: 'Agent',
      capturedEmail: 'prechat@x.com',
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationMessageEmail.mock.calls[0][0]).toMatchObject({ to: 'prechat@x.com' })
  })

  it('sends nothing when an anonymous visitor has neither an account email nor a captured email', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'anonymous', email: null }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'answer',
      agentName: 'Agent',
      capturedEmail: null,
    })

    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('swallows a thrown dependency (does not reject)', async () => {
    isPrincipalOnline.mockRejectedValue(new Error('redis down'))

    await expect(
      notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
        capturedEmail: 'prechat@x.com',
      })
    ).resolves.toBeUndefined()
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  describe('inbound-email Reply-To', () => {
    const prevDomain = process.env.EMAIL_INBOUND_DOMAIN
    const prevSecret = process.env.EMAIL_INBOUND_SIGNING_SECRET

    afterEach(() => {
      if (prevDomain === undefined) delete process.env.EMAIL_INBOUND_DOMAIN
      else process.env.EMAIL_INBOUND_DOMAIN = prevDomain
      if (prevSecret === undefined) delete process.env.EMAIL_INBOUND_SIGNING_SECRET
      else process.env.EMAIL_INBOUND_SIGNING_SECRET = prevSecret
    })

    it('sets a conversation-specific Reply-To when inbound email is configured', async () => {
      process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
      process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'here is your answer',
        agentName: 'Agent',
      })

      // Signed plus-address: reply+<id-suffix>.<hmac>@domain (unforgeable; the
      // `conversation_` prefix is dropped to stay under the 64-char local part).
      const suffix = conversationId.replace(/^conversation_/, '')
      expect(sendConversationMessageEmail.mock.calls[0][0].replyTo).toMatch(
        new RegExp(`^reply\\+${suffix}\\.[A-Za-z0-9_-]+@tenaevexeo\\.resend\\.app$`)
      )
    })

    it('omits Reply-To when inbound email is not configured', async () => {
      delete process.env.EMAIL_INBOUND_DOMAIN
      delete process.env.EMAIL_INBOUND_SIGNING_SECRET
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'here is your answer',
        agentName: 'Agent',
      })

      expect(sendConversationMessageEmail.mock.calls[0][0].replyTo).toBeUndefined()
    })
  })
})
