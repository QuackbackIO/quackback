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
// notifyCsatRequestEmail issues TWO sequential `.limit(1)` selects (the
// conversation's channel/visitorPrincipalId, then the visitor row) — queued
// FIFO so each gets its own result. Empty (the common case for every other
// describe block below) falls back to `visitorRows`, so this is additive and
// changes nothing for the pre-existing notifyAgentReply/notifyVisitorMessage
// tests below.
let limitQueue: Array<Record<string, unknown>[]> = []

const isAnyAgentOnline = vi.fn<() => Promise<boolean>>()
const isPrincipalOnline = vi.fn<(p: PrincipalId) => Promise<boolean>>()
const createNotificationsBatch = vi.fn<(input: unknown) => Promise<unknown>>()
const buildHookContext =
  vi.fn<
    () => Promise<{ workspaceName: string; portalBaseUrl: string; logoUrl: string | null } | null>
  >()
const sendConversationMessageEmail = vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>()
const sendCsatRequestEmail = vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>()
const mintCsatEmailToken =
  vi.fn<(conversationId: ConversationId, visitorPrincipalId: PrincipalId) => string>()

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

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
  sendCsatRequestEmail: (...a: [Record<string, unknown>]) => sendCsatRequestEmail(...a),
}))

// notifyCsatRequestEmail's mint import (moved here from action.executor.ts —
// see the module doc's CSAT-over-email paragraph).
vi.mock('../csat-email-token', () => ({
  mintCsatEmailToken: (...a: [ConversationId, PrincipalId]) => mintCsatEmailToken(...a),
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

// Spread the real db module (so every table export the notify path touches —
// including channelAccounts, added with the email channel — is present) and
// override ONLY the `db` handle. Re-listing tables here is the banned pattern
// that broke when channelAccounts landed.
vi.mock('@/lib/server/db', async (importOriginal) => {
  // A thenable chain. `.where()` resolves to the team rows (so a bare await on
  // the where() builder yields the array); `.limit()` resolves to the single
  // visitor row. `.then` makes the where() builder awaitable directly.
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.limit = async () => (limitQueue.length ? limitQueue.shift()! : visitorRows)
    c.then = (resolve: (v: unknown) => unknown) => resolve(teamRows)
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain() },
  }
})

import {
  notifyVisitorMessage,
  notifyAgentReply,
  notifyCsatRequestEmail,
} from '../conversation.notify'
import { generateContentHTML } from '@/lib/shared/content-html'

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
  limitQueue = []
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
      ctaUrl: `https://acme.example.com/admin/inbox?i=${conversationId}`,
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

// notifyTeamAssigned was removed in WO-3 slice 2: the team-assignment bell now
// rides the `conversation.assigned` event through the event/hook pipeline
// instead of a direct createNotificationsBatch call here. The characterization
// this block used to pin (team members minus the actor; type 'chat_message',
// deliberately now 'conversation_assigned'; title 'A conversation was assigned
// to your team') is ported to
// events/__tests__/targets-assignment.test.ts (recipient resolution) and
// events/__tests__/notification-handler.test.ts (title/type/metadata).

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

// CSAT-over-email (support platform's CSAT-over-email extension, moved here
// from action.executor.ts — see this module's own doc on notifyCsatRequestEmail):
// a request_csat block on an email-channel conversation also gets a dedicated
// rating-request email, since the in-app emoji row is inert in an email client.
describe('notifyCsatRequestEmail', () => {
  const visitorPrincipalId = 'principal_visitor' as PrincipalId

  it('does not send an email when the conversation channel is not email', async () => {
    limitQueue = [[{ channel: 'messenger', visitorPrincipalId }]]

    await notifyCsatRequestEmail(conversationId, 'How did we do?')

    expect(sendCsatRequestEmail).not.toHaveBeenCalled()
  })

  it('does not send an email when the conversation has no visitor principal', async () => {
    limitQueue = [[{ channel: 'email', visitorPrincipalId: null }]]

    await notifyCsatRequestEmail(conversationId, 'How did we do?')

    expect(sendCsatRequestEmail).not.toHaveBeenCalled()
  })

  it('does not send an email when the visitor has no deliverable recipient', async () => {
    limitQueue = [
      [{ channel: 'email', visitorPrincipalId }],
      [{ type: 'anonymous', email: null, contactEmail: null }],
    ]

    await notifyCsatRequestEmail(conversationId, 'How did we do?')

    expect(sendCsatRequestEmail).not.toHaveBeenCalled()
  })

  it('sends the CSAT-over-email request when the channel is email and the visitor is reachable', async () => {
    limitQueue = [
      [{ channel: 'email', visitorPrincipalId }],
      [{ type: 'user', email: 'visitor@example.com', contactEmail: null }],
    ]
    mintCsatEmailToken.mockReturnValue('signed-token')
    sendCsatRequestEmail.mockResolvedValue({ sent: true })

    await notifyCsatRequestEmail(conversationId, 'How did we do?')

    expect(mintCsatEmailToken).toHaveBeenCalledWith(conversationId, visitorPrincipalId)
    expect(sendCsatRequestEmail).toHaveBeenCalledWith({
      to: 'visitor@example.com',
      promptText: 'How did we do?',
      ratingUrls: [
        'https://acme.example.com/csat?token=signed-token&rating=1',
        'https://acme.example.com/csat?token=signed-token&rating=2',
        'https://acme.example.com/csat?token=signed-token&rating=3',
        'https://acme.example.com/csat?token=signed-token&rating=4',
        'https://acme.example.com/csat?token=signed-token&rating=5',
      ],
      workspaceName: 'Acme',
      logoUrl: undefined,
    })
  })

  it('swallows a thrown dependency (does not reject) — best-effort, same as every other notify* function', async () => {
    limitQueue = [
      [{ channel: 'email', visitorPrincipalId }],
      [{ type: 'user', email: 'visitor@example.com', contactEmail: null }],
    ]
    mintCsatEmailToken.mockReturnValue('signed-token')
    sendCsatRequestEmail.mockRejectedValue(new Error('provider down'))

    await expect(notifyCsatRequestEmail(conversationId, 'How did we do?')).resolves.toBeUndefined()
  })
})

// P4.5: the outbound conversation email carries the whole message body, not just
// a ~120-char excerpt. bodyHtml is the rich contentJson rendered to HTML, or the
// FULL plain-text content wrapped in escaped paragraphs; the truncated preview is
// retained only as messagePreview (subject/preheader).
describe('conversation email body (P4.5)', () => {
  const visitorPrincipalId = 'principal_visitor' as PrincipalId

  it('renders the rich contentJson as bodyHtml while keeping the truncated preview separate', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    const contentJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Here is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'Here is bold',
      contentJson,
      agentName: 'Agent',
    })

    const call = sendConversationMessageEmail.mock.calls[0][0]
    // bodyHtml is exactly what the shared serializer produces for the doc.
    expect(call.bodyHtml).toBe(generateContentHTML(contentJson))
    expect(call.bodyHtml).toContain('<strong>bold</strong>')
    // The preview excerpt is still provided for the subject/preheader.
    expect(call.messagePreview).toBe('Here is bold')
  })

  it('appends the ?email=1 proxy hint to self-origin storage image srcs only', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    const contentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'see:' }] },
        // Self-origin storage ref: mail clients won't follow the route's 302,
        // so the email body must carry the force-proxy hint.
        { type: 'chatImage', attrs: { src: '/api/storage/chat-images/a.png' } },
        // Foreign origin: left byte-identical.
        { type: 'resizableImage', attrs: { src: 'https://cdn.example.com/b.png' } },
      ],
    }

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'see:',
      contentJson,
      agentName: 'Agent',
    })

    const call = sendConversationMessageEmail.mock.calls[0][0]
    expect(call.bodyHtml).toContain('/api/storage/chat-images/a.png?email=1')
    expect(call.bodyHtml).toContain('https://cdn.example.com/b.png')
    expect(call.bodyHtml).not.toContain('b.png?email=1')
  })

  it('falls back to the FULL plain-text content wrapped in escaped <p> paragraphs (no contentJson)', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    // Long, multi-paragraph, and containing HTML-special chars.
    const body = `${'A'.repeat(200)}\n\nsecond <script> line`

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: body,
      agentName: 'Agent',
    })

    const call = sendConversationMessageEmail.mock.calls[0][0]
    // The whole body (not the 140-char preview), split on the blank line and
    // with text escaped so stored content can't inject HTML into the inbox.
    expect(call.bodyHtml).toBe(`<p>${'A'.repeat(200)}</p><p>second &lt;script&gt; line</p>`)
    // messagePreview stays the truncated excerpt.
    expect((call.messagePreview as string).length).toBeLessThan(body.length)
  })
})

// P4.6: pin the RFC 5322 threading headers byte-for-byte so the P4.5 body change
// can't perturb Message-ID / In-Reply-To / References (which back conversation
// threading + inbound reply routing).
describe('threading headers (P4.6 regression guard)', () => {
  const visitorPrincipalId = 'principal_visitor' as PrincipalId

  it('omits all threading headers and records no outbound id when no sending domain is configured', async () => {
    // Base test env: EMAIL_FROM and EMAIL_INBOUND_DOMAIN are both unset, so no
    // Message-ID is minted and nothing is persisted to the threading store.
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'hello',
      agentName: 'Agent',
    })

    const call = sendConversationMessageEmail.mock.calls[0][0]
    expect(call.messageId).toBeUndefined()
    expect(call.inReplyTo).toBeUndefined()
    expect(call.references).toBeUndefined()
    expect(recordOutboundEmail).not.toHaveBeenCalled()
  })

  describe('with a sending domain configured', () => {
    const prevDomain = process.env.EMAIL_INBOUND_DOMAIN
    const prevSecret = process.env.EMAIL_INBOUND_SIGNING_SECRET

    beforeEach(() => {
      process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
      process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
    })
    afterEach(() => {
      if (prevDomain === undefined) delete process.env.EMAIL_INBOUND_DOMAIN
      else process.env.EMAIL_INBOUND_DOMAIN = prevDomain
      if (prevSecret === undefined) delete process.env.EMAIL_INBOUND_SIGNING_SECRET
      else process.env.EMAIL_INBOUND_SIGNING_SECRET = prevSecret
    })

    it('mints a fresh Message-ID (no parent) and records it against the conversation', async () => {
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]
      // No prior outbound mails → nothing to reply to / reference.
      priorOutboundMessageIds.mockResolvedValue([])

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
      })

      const call = sendConversationMessageEmail.mock.calls[0][0]
      const suffix = conversationId.replace(/^conversation_/, '')
      expect(call.messageId).toMatch(
        new RegExp(`^c\\.${suffix}\\.[A-Za-z0-9_-]+@tenaevexeo\\.resend\\.app$`)
      )
      expect(call.inReplyTo).toBeUndefined()
      expect(call.references).toBeUndefined()
      // The minted id is persisted (so a later reply threads back to it).
      expect(recordOutboundEmail).toHaveBeenCalledWith(call.messageId, conversationId)
    })

    it('carries the prior-id References chain and sets In-Reply-To to the latest', async () => {
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]
      const prior = ['c.1.aaa@tenaevexeo.resend.app', 'c.1.bbb@tenaevexeo.resend.app']
      priorOutboundMessageIds.mockResolvedValue(prior)

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
      })

      const call = sendConversationMessageEmail.mock.calls[0][0]
      expect(call.references).toEqual(prior)
      expect(call.inReplyTo).toBe('c.1.bbb@tenaevexeo.resend.app')
    })
  })
})
