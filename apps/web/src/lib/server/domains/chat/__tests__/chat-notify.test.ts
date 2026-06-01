/**
 * Offline chat notifications (chat.notify): who gets pinged and emailed when a
 * visitor messages, when a note @-mentions a teammate, and when an agent replies
 * to an offline visitor. All three paths are fire-and-forget and must swallow
 * dependency errors rather than reject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'

// Drives the team/visitor SELECT result. notifyVisitorMessage & notifyNoteMentions
// resolve the `.where(...)` thenable to a team array; notifyAgentReply resolves
// `.limit(1)` to a single-row visitor array.
let teamRows: Array<Record<string, unknown>> = []
let visitorRows: Array<Record<string, unknown>> = []
// Watchers of the conversation (P1.6b) — resolved by the mocked chat.query.
let watcherRows: Array<{ principalId: string; email: string | null; name: string | null }> = []

const isAnyAgentOnline = vi.fn<() => Promise<boolean>>()
const isPrincipalOnline = vi.fn<(p: PrincipalId) => Promise<boolean>>()
const createNotificationsBatch = vi.fn<(input: unknown) => Promise<unknown>>()
const buildHookContext =
  vi.fn<
    () => Promise<{ workspaceName: string; portalBaseUrl: string; logoUrl: string | null } | null>
  >()
const sendChatMessageEmail = vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>()

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
  sendChatMessageEmail: (...a: [Record<string, unknown>]) => sendChatMessageEmail(...a),
}))

// Signed resume token (P2.6) — stub so the test doesn't pull in config/secretKey.
vi.mock('@/lib/server/realtime/chat-resume-token', () => ({
  mintConversationResumeToken: () => 'tok_test',
}))

// Watchers (P1.6b) — notifyVisitorMessage queries this; drive it per test.
vi.mock('../chat.query', () => ({
  getWatchersForConversation: () => Promise.resolve(watcherRows),
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

import { notifyVisitorMessage, notifyNoteMentions, notifyAgentReply } from '../chat.notify'

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
  watcherRows = []
  vi.clearAllMocks()
  // Silence the fire-and-forget warning logs.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  buildHookContext.mockResolvedValue(ctx)
  createNotificationsBatch.mockResolvedValue(undefined)
  sendChatMessageEmail.mockResolvedValue(undefined)
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
    expect(sendChatMessageEmail).not.toHaveBeenCalled()
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
      title: 'New chat message from Visitor',
      metadata: { conversationId },
    })
    expect(sendChatMessageEmail).not.toHaveBeenCalled()
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
    expect(sendChatMessageEmail).toHaveBeenCalledTimes(2)
    const firstEmail = sendChatMessageEmail.mock.calls[0][0]
    expect(firstEmail).toMatchObject({
      to: 'a@x.com',
      direction: 'visitor_message',
      senderName: 'Jane',
      ctaUrl: `https://acme.example.com/admin/chat?conversation=${conversationId}`,
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
    expect(sendChatMessageEmail).not.toHaveBeenCalled()
  })

  it('notifies a watcher even when the team broadcast is suppressed (P1.6b)', async () => {
    // Agent online + not the first message → the broad team is NOT pinged...
    isAnyAgentOnline.mockResolvedValue(true)
    teamRows = [{ principalId: 'principal_admin', email: 'a@x.com', name: 'A' }]
    // ...but a watcher opted into this conversation, so they still get pinged.
    watcherRows = [{ principalId: 'principal_watcher', email: 'w@x.com', name: 'W' }]

    await notifyVisitorMessage({
      conversation,
      content: 'follow-up message',
      authorName: 'Visitor',
      isFirstMessage: false,
    })

    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    // Only the watcher — the broad team query is skipped while an agent is live.
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({ principalId: 'principal_watcher' })
    // Agent online → no offline email.
    expect(sendChatMessageEmail).not.toHaveBeenCalled()
  })

  it('dedupes a watcher who is also in the broad team (no double notification)', async () => {
    isAnyAgentOnline.mockResolvedValue(false)
    teamRows = [{ principalId: 'principal_admin', email: 'a@x.com', name: 'A' }]
    watcherRows = [{ principalId: 'principal_admin', email: 'a@x.com', name: 'A' }]

    await notifyVisitorMessage({
      conversation,
      content: 'hi',
      authorName: 'Visitor',
      isFirstMessage: true,
    })

    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(1)
    // No agent online → one email, not two.
    expect(sendChatMessageEmail).toHaveBeenCalledTimes(1)
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

describe('notifyNoteMentions', () => {
  it('is a no-op when the content has no @tokens', async () => {
    teamRows = [{ principalId: 'principal_jane', email: 'jane.doe@x.com' }]

    await notifyNoteMentions({
      conversationId,
      content: 'just a plain note with no mentions',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('notifies teammates whose email local-part matches an @token, case-insensitively', async () => {
    teamRows = [
      { principalId: 'principal_jane', email: 'Jane.Doe@example.com' },
      { principalId: 'principal_bob', email: 'bob@example.com' },
    ]

    await notifyNoteMentions({
      conversationId,
      content: 'hey @jane.doe can you take this one',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({
      principalId: 'principal_jane',
      type: 'chat_mention',
      title: 'Author mentioned you in a chat',
      metadata: { conversationId },
    })
  })

  it('never notifies the author even when their own local-part is mentioned', async () => {
    teamRows = [{ principalId: 'principal_author', email: 'author@example.com' }]

    await notifyNoteMentions({
      conversationId,
      content: 'note to self @author',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('treats a non-matching @token as plain text (no notification)', async () => {
    teamRows = [{ principalId: 'principal_jane', email: 'jane.doe@example.com' }]

    await notifyNoteMentions({
      conversationId,
      content: 'ping @nobody about the @ thing',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('does not treat the domain of a pasted email as a mention', async () => {
    teamRows = [{ principalId: 'principal_jane', email: 'jane.doe@example.com' }]

    await notifyNoteMentions({
      conversationId,
      // The @ here belongs to an email address, not a mention.
      content: 'forward this to billing@jane.doe please',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('matches a real @mention at the start of the note', async () => {
    teamRows = [{ principalId: 'principal_jane', email: 'jane.doe@example.com' }]

    await notifyNoteMentions({
      conversationId,
      content: '@jane.doe can you take this?',
      authorPrincipalId: 'principal_author' as PrincipalId,
      authorName: 'Author',
    })

    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
  })

  it('swallows a thrown dependency (does not reject)', async () => {
    teamRows = [{ principalId: 'principal_jane', email: 'jane.doe@example.com' }]
    createNotificationsBatch.mockRejectedValue(new Error('db down'))

    await expect(
      notifyNoteMentions({
        conversationId,
        content: 'hey @jane.doe',
        authorPrincipalId: 'principal_author' as PrincipalId,
        authorName: 'Author',
      })
    ).resolves.toBeUndefined()
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

    expect(sendChatMessageEmail).not.toHaveBeenCalled()
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

    expect(sendChatMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendChatMessageEmail.mock.calls[0][0]).toMatchObject({
      to: 'account@x.com',
      direction: 'agent_reply',
      senderName: 'Agent',
      // Signed cross-device resume deep-link (P2.6).
      ctaUrl: expect.stringContaining('https://acme.example.com/api/chat/resume?token='),
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

    expect(sendChatMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendChatMessageEmail.mock.calls[0][0]).toMatchObject({ to: 'prechat@x.com' })
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

    expect(sendChatMessageEmail).not.toHaveBeenCalled()
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
    expect(sendChatMessageEmail).not.toHaveBeenCalled()
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

      expect(sendChatMessageEmail.mock.calls[0][0]).toMatchObject({
        replyTo: `reply+${conversationId}@tenaevexeo.resend.app`,
      })
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

      expect(sendChatMessageEmail.mock.calls[0][0].replyTo).toBeUndefined()
    })
  })
})
