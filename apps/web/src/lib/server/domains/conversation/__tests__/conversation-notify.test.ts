/**
 * Offline conversation notifications (conversation.notify): who gets pinged and emailed when a
 * visitor messages, when a note @-mentions a teammate, and when an agent replies
 * to an offline visitor. All three paths are fire-and-forget and must swallow
 * dependency errors rather than reject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import type { Conversation } from '@/lib/server/db'
import { conversationIdFromInboundAddress } from '../conversation.email-channel'
import { SELF_HOSTED_MAIL_SLUG } from '../conversation.mail-slug'

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
const priorInboundEmailMessageIds = vi.fn<(...a: unknown[]) => Promise<string[]>>(async () => [])
const threadIdsForOutbound = vi.fn<
  (...a: unknown[]) => Promise<{ inbound: string[]; outbound: string[]; merged: string[] }>
>(async () => {
  const outbound = await priorOutboundMessageIds()
  const inbound = await priorInboundEmailMessageIds()
  return { inbound, outbound, merged: [...inbound, ...outbound] }
})
const recordOutboundEmail = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {})
const recordEmailIdentity = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {})
vi.mock('../conversation.email-store', () => ({
  priorOutboundMessageIds: (...a: unknown[]) => priorOutboundMessageIds(...a),
  priorInboundEmailMessageIds: (...a: unknown[]) => priorInboundEmailMessageIds(...a),
  threadIdsForOutbound: (...a: unknown[]) => threadIdsForOutbound(...a),
  recordOutboundEmail: (...a: unknown[]) => recordOutboundEmail(...a),
  recordEmailIdentity: (...a: unknown[]) => recordEmailIdentity(...a),
}))

// Visitor deep links consult the portal-support gate; default to the widget
// link (portal support off) so existing expectations hold.
const isPortalSupportEnabled = vi.fn<() => Promise<boolean>>(async () => false)
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: () => isPortalSupportEnabled(),
}))

// The From a conversation's outbound mail leaves as. Mocked because its own
// resolution (and the sending-identity guard behind it) is tested where it
// lives; what this suite pins is that the SAME answer reaches every mail in a
// thread. A rating prompt that arrived from the platform address on a
// conversation answered from the customer's own support address is a thread
// that changes identity halfway through.
const resolveConversationFrom = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null)
vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/channel-accounts/channel-account.service')>()),
  resolveConversationFrom: (...a: unknown[]) => resolveConversationFrom(...a),
}))

// The group-thread fan-out (§4.8): which added customers a reply goes out to.
// Default none — the pre-group-thread assertions below keep their call counts.
const listParticipantReplyRecipients =
  vi.fn<(...a: unknown[]) => Promise<Array<{ principalId: PrincipalId; email: string }>>>()
vi.mock('../conversation-participant.service', () => ({
  listParticipantReplyRecipients: (...a: unknown[]) => listParticipantReplyRecipients(...a),
}))

// Spread the real db module (so every table export the notify path touches —
// including channelAccounts, added with the email channel — is present) and
// override ONLY the `db` handle. Re-listing tables here is the banned pattern
// that broke when channelAccounts landed.
// Address resolution has its own tests; this suite is about who gets fanned
// out to, so the resolver returns whatever the fixture's team rows carry.
vi.mock('@/lib/server/email/recipient', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/email/recipient')>()
  return {
    ...actual,
    // Mirrors the real resolver against the fixture's rows rather than
    // inventing addresses: a teammate with no address must stay unreachable, or
    // the fan-out assertion stops meaning anything.
    resolveContactRecipients: vi.fn(async (ids: string[]) => {
      const byId = new Map(teamRows.map((t) => [t.principalId, t.email]))
      return new Map(
        ids.flatMap((id) => {
          const email = byId.get(id)
          return email ? [[id, email] as const] : []
        })
      )
    }),
  }
})

vi.mock('@/lib/server/db', async (importOriginal) => {
  // A thenable chain. `.where()` resolves to the team rows (so a bare await on
  // the where() builder yields the array); `.limit()` resolves to the single
  // visitor row. `.then` makes the where() builder awaitable directly.
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.leftJoin = () => c
    c.where = () => c
    c.orderBy = () => c
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
  EMAIL_SEND_RETRY_DELAYS_MS,
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
  // The shape every rung of the send layer actually returns. `undefined` is not
  // one of them, and defaulting to it would leave the caller's handling of a
  // reported Message-ID exercised by nothing.
  sendConversationMessageEmail.mockResolvedValue({ sent: true })
  listParticipantReplyRecipients.mockResolvedValue([])
})

describe('notifyVisitorMessage', () => {
  // WO-3 slice 5: notifyVisitorMessage is now EMAIL-ONLY — the in-app team
  // bell for the same event moved to the message.created event/hook
  // pipeline (events/__tests__/targets-message-created.test.ts +
  // events/__tests__/notification-handler.test.ts carry the ported
  // recipient/title/body assertions, plus the bell's own anti-spam presence
  // gate, which now runs in the notification hook's worker instead of here).
  it('sends no email when an agent is online and it is not the first message', async () => {
    isAnyAgentOnline.mockResolvedValue(true)
    teamRows = [{ principalId: 'principal_admin', email: 'a@x.com', name: 'A' }]

    await notifyVisitorMessage({
      conversation,
      content: 'hi',
      authorName: 'Visitor',
      isFirstMessage: false,
    })

    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('sends no email on the first message while an agent is online', async () => {
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

    // The null-email teammate is filtered out of the email fan-out.
    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(2)
    const firstEmail = sendConversationMessageEmail.mock.calls[0][0]
    expect(firstEmail).toMatchObject({
      to: 'a@x.com',
      direction: 'visitor_message',
      senderName: 'Jane',
      isFirstMessage: false,
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
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
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

  it('returns early without emailing an online visitor on a MESSENGER conversation', async () => {
    isPrincipalOnline.mockResolvedValue(true)
    visitorRows = [{ type: 'user', email: 'v@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'thanks for waiting',
      agentName: 'Agent',
      channel: 'messenger',
    })

    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  // The regression pin for the presence-suppression defect: on an email
  // conversation the visitor's mailbox IS the thread, so a live stream
  // elsewhere must not swallow the reply. Contrast with the case above —
  // identical input except the channel.
  it('emails an ONLINE visitor when the conversation is on the email channel', async () => {
    isPrincipalOnline.mockResolvedValue(true)
    visitorRows = [{ type: 'user', email: 'v@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'thanks for waiting',
      agentName: 'Agent',
      channel: 'email',
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationMessageEmail.mock.calls[0][0]).toMatchObject({
      to: 'v@x.com',
      direction: 'agent_reply',
    })
    // Presence is not even consulted on an email conversation.
    expect(isPrincipalOnline).not.toHaveBeenCalled()
  })

  it('prefers an identified visitor account email', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'here is your answer',
      agentName: 'Agent',
      channel: 'messenger',
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
      channel: 'messenger',
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
      channel: 'messenger',
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
        channel: 'messenger',
        capturedEmail: 'prechat@x.com',
      })
    ).resolves.toBeUndefined()
    expect(sendConversationMessageEmail).not.toHaveBeenCalled()
  })

  it('emails every added customer the reply too (group thread)', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'v@x.com' }]
    listParticipantReplyRecipients.mockResolvedValue([
      { principalId: 'principal_p1' as PrincipalId, email: 'second@example.com' },
      { principalId: 'principal_p2' as PrincipalId, email: 'third@example.com' },
    ])

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'the fix is deployed',
      agentName: 'Agent',
      channel: 'messenger',
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(3)
    const tos = sendConversationMessageEmail.mock.calls.map((c) => c[0].to)
    expect(tos).toEqual(['v@x.com', 'second@example.com', 'third@example.com'])
    // The fan-out reads this conversation's participants, excluding the primary
    // visitor and the address already sent to.
    expect(listParticipantReplyRecipients).toHaveBeenCalledWith(
      conversationId,
      visitorPrincipalId,
      'v@x.com'
    )
  })

  it('still emails participants when the primary visitor is unreachable', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'anonymous', email: null }]
    listParticipantReplyRecipients.mockResolvedValue([
      { principalId: 'principal_p1' as PrincipalId, email: 'second@example.com' },
    ])

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'the fix is deployed',
      agentName: 'Agent',
      channel: 'messenger',
      capturedEmail: null,
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
    expect(sendConversationMessageEmail.mock.calls[0][0]).toMatchObject({
      to: 'second@example.com',
      direction: 'agent_reply',
    })
  })

  it("one participant's send failure never eats the remaining participants", async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'v@x.com' }]
    listParticipantReplyRecipients.mockResolvedValue([
      { principalId: 'principal_p1' as PrincipalId, email: 'bad@example.com' },
      { principalId: 'principal_p2' as PrincipalId, email: 'good@example.com' },
    ])
    sendConversationMessageEmail.mockImplementation(async (opts: { to?: string }) => {
      if (opts.to === 'bad@example.com') throw new Error('provider bounce')
      return undefined
    })

    await expect(
      notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'the fix is deployed',
        agentName: 'Agent',
        channel: 'messenger',
      })
    ).resolves.toBeUndefined()

    const tos = sendConversationMessageEmail.mock.calls.map((c) => c[0].to)
    // bad@ retried through the retry budget, good@ still delivered after it.
    expect(tos[tos.length - 1]).toBe('good@example.com')
    expect(tos).toContain('v@x.com')
  })

  describe('inbound-email Reply-To', () => {
    const prevDomain = process.env.EMAIL_INBOUND_DOMAIN
    const prevSecret = process.env.EMAIL_INBOUND_SIGNING_SECRET
    const prevTenancy = process.env.QUACKBACK_TENANCY

    /** The one Reply-To the send layer was handed, or undefined. */
    async function replyToOf(run: (fn: () => Promise<void>) => Promise<void>): Promise<unknown> {
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]
      await run(async () => {
        await notifyAgentReply({
          conversationId,
          visitorPrincipalId,
          content: 'here is your answer',
          agentName: 'Agent',
          channel: 'messenger',
        })
      })
      expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
      return sendConversationMessageEmail.mock.calls[0][0].replyTo
    }

    const bare = (fn: () => Promise<void>) => fn()

    afterEach(() => {
      if (prevDomain === undefined) delete process.env.EMAIL_INBOUND_DOMAIN
      else process.env.EMAIL_INBOUND_DOMAIN = prevDomain
      if (prevSecret === undefined) delete process.env.EMAIL_INBOUND_SIGNING_SECRET
      else process.env.EMAIL_INBOUND_SIGNING_SECRET = prevSecret
      if (prevTenancy === undefined) delete process.env.QUACKBACK_TENANCY
      else process.env.QUACKBACK_TENANCY = prevTenancy
    })

    // An inbound address names the workspace it belongs to, because one inbound
    // domain can stand in front of a whole fleet. Where that name comes from is
    // the only part that differs between a fleet replica and a self-hosted
    // install, so all three outcomes are pinned here.
    it('advertises an address under the active workspace’s mail slug', async () => {
      process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
      process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
      process.env.QUACKBACK_TENANCY = 'pooled'

      const replyTo = await replyToOf((fn) => withWorkspace('neon-t2', fn))

      expect(replyTo).toMatch(
        new RegExp(`^${mailSlugFor('neon-t2')}\\+c1\\.[A-Za-z0-9_-]{22}@tenaevexeo\\.resend\\.app$`)
      )
      // The address is not merely slug-shaped: it verifies back to this
      // conversation, which is the whole point of advertising it.
      expect(conversationIdFromInboundAddress(String(replyTo))).toBe(conversationId)
    })

    it('advertises the self-hosted label when there is no workspace scope', async () => {
      // A single-workspace install owns its whole inbound domain, and `reply` is
      // the label the grammar minted under before a fleet existed — so the mail
      // routing an install already has keeps receiving. Falling to no address
      // here would end reply-by-email for every self-hoster on upgrade.
      process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
      process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
      delete process.env.QUACKBACK_TENANCY

      const replyTo = await replyToOf(bare)

      expect(replyTo).toMatch(
        new RegExp(`^${SELF_HOSTED_MAIL_SLUG}\\+c1\\.[A-Za-z0-9_-]{22}@tenaevexeo\\.resend\\.app$`)
      )
      expect(conversationIdFromInboundAddress(String(replyTo))).toBe(conversationId)
    })

    it('omits Reply-To on a pooled process with no workspace resolved', async () => {
      // The address would name no workspace, so the shared front door could not
      // route it: better no route home than one that does not exist.
      process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
      process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
      process.env.QUACKBACK_TENANCY = 'pooled'

      expect(await replyToOf(bare)).toBeUndefined()
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
        channel: 'messenger',
      })

      expect(sendConversationMessageEmail.mock.calls[0][0].replyTo).toBeUndefined()
    })
  })
})

// The send path is fire-and-forget behind a `void` call, so a throw from the
// provider has no caller to surface it: the message row is already committed and
// the thread already shows the reply as sent. A bounded retry is what stops a
// brief provider outage from silently losing it.
describe('conversation email send retry', () => {
  const visitorPrincipalId = 'principal_visitor' as PrincipalId
  const realDelays = [...EMAIL_SEND_RETRY_DELAYS_MS]

  beforeEach(() => {
    // Keep the suite fast: same attempt budget, no real waiting.
    EMAIL_SEND_RETRY_DELAYS_MS.splice(0, EMAIL_SEND_RETRY_DELAYS_MS.length, 0, 0)
  })
  afterEach(() => {
    EMAIL_SEND_RETRY_DELAYS_MS.splice(0, EMAIL_SEND_RETRY_DELAYS_MS.length, ...realDelays)
  })

  it('retries a throwing provider and records the outbound id exactly once on success', async () => {
    process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
    process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_test'
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    sendConversationMessageEmail
      .mockRejectedValueOnce(new Error('provider 503'))
      .mockResolvedValueOnce({ sent: true })

    await notifyAgentReply({
      conversationId,
      visitorPrincipalId,
      content: 'answer',
      agentName: 'Agent',
      channel: 'messenger',
    })

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(2)
    // Threading is minted ONCE above the retry: a fresh Message-ID per attempt
    // would deliver two mails that neither dedupe nor thread together.
    const [first, second] = sendConversationMessageEmail.mock.calls
    expect(second[0].messageId).toBe(first[0].messageId)
    expect(recordOutboundEmail).toHaveBeenCalledTimes(1)

    delete process.env.EMAIL_INBOUND_DOMAIN
    delete process.env.EMAIL_INBOUND_SIGNING_SECRET
  })

  it('does not retry an error that declares itself permanent', async () => {
    // Retrying is the default precisely because a hand-maintained taxonomy of
    // transient errors fails closed. An error that says re-sending reproduces it
    // is the one thing worth honouring: a From on a domain the provider is not
    // authorized for is the same rejection every time, and spending the budget
    // on it only delays the failure.
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    sendConversationMessageEmail.mockRejectedValue(
      Object.assign(new Error('domain not onboarded'), { retryable: false })
    )

    await expect(
      notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
        channel: 'email',
      })
    ).resolves.toBeUndefined()

    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(1)
    expect(recordOutboundEmail).not.toHaveBeenCalled()
  })

  it('gives up after the retry budget without rejecting or recording the send', async () => {
    isPrincipalOnline.mockResolvedValue(false)
    visitorRows = [{ type: 'user', email: 'account@x.com' }]
    sendConversationMessageEmail.mockRejectedValue(new Error('provider down'))

    await expect(
      notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
        channel: 'email',
      })
    ).resolves.toBeUndefined()

    // Two delays configured = three attempts total.
    expect(sendConversationMessageEmail).toHaveBeenCalledTimes(3)
    // Nothing is recorded for a mail that never left: an id in the threading map
    // would corrupt the References chain and the inbound Message-ID match.
    expect(recordOutboundEmail).not.toHaveBeenCalled()
    expect(recordEmailIdentity).not.toHaveBeenCalled()
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
      from: undefined,
      conversationId,
    })
  })

  it('asks the rating from the address the thread is already being answered from', async () => {
    // The conversation is answered as the customer's own support address, so the
    // prompt has to arrive from there too. From the recipient's side — and from
    // their mail client's threading — a different sender is a different
    // conversation.
    limitQueue = [
      [{ channel: 'email', visitorPrincipalId }],
      [{ type: 'user', email: 'visitor@example.com', contactEmail: null }],
    ]
    mintCsatEmailToken.mockReturnValue('signed-token')
    sendCsatRequestEmail.mockResolvedValue({ sent: true })
    resolveConversationFrom.mockResolvedValue('support@tenant-a.example')

    await notifyCsatRequestEmail(conversationId, 'How did we do?')

    expect(resolveConversationFrom).toHaveBeenCalledWith(conversationId)
    expect(sendCsatRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'support@tenant-a.example' })
    )
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
      channel: 'messenger',
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
      channel: 'messenger',
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
      channel: 'messenger',
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
      channel: 'messenger',
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
        channel: 'messenger',
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
        channel: 'messenger',
      })

      const call = sendConversationMessageEmail.mock.calls[0][0]
      expect(call.references).toEqual(prior)
      expect(call.inReplyTo).toBe('c.1.bbb@tenaevexeo.resend.app')
    })

    it('forwards the stored conversation subject to the sender', async () => {
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]
      limitQueue = [
        [{ type: 'user', email: 'account@x.com' }],
        [{ subject: 'Re: Billing overcharge', channel: 'email' }],
      ]

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Alex',
        channel: 'email',
      })

      const call = sendConversationMessageEmail.mock.calls[0][0]
      expect(call.conversationSubject).toBe('Re: Billing overcharge')
      expect(call.channel).toBe('email')
    })

    it("puts the customer's inbound Message-ID in In-Reply-To and References", async () => {
      isPrincipalOnline.mockResolvedValue(false)
      visitorRows = [{ type: 'user', email: 'account@x.com' }]
      priorOutboundMessageIds.mockResolvedValue(['c.1.aaa@tenaevexeo.resend.app'])
      priorInboundEmailMessageIds.mockResolvedValue(['cust-inbound@mail.example'])

      await notifyAgentReply({
        conversationId,
        visitorPrincipalId,
        content: 'answer',
        agentName: 'Agent',
        channel: 'email',
      })

      const call = sendConversationMessageEmail.mock.calls[0][0]
      expect(call.inReplyTo).toBe('cust-inbound@mail.example')
      expect(call.references).toEqual([
        'cust-inbound@mail.example',
        'c.1.aaa@tenaevexeo.resend.app',
      ])
      expect(call.channel).toBe('email')
      // Named From is on the resolved identity when one exists, else on
      // fromDisplayName so dispatch can wrap EMAIL_FROM.
      expect(
        [call.from, call.fromDisplayName].some(
          (value) => typeof value === 'string' && value.includes('Agent (Acme)')
        )
      ).toBe(true)
    })

    /**
     * Which Message-ID is stored is decided by the send layer's three-state
     * answer, and the three states mean genuinely different things: we own the
     * header, the transport owns it and said which id it used, or the transport
     * owns it and did not say. Only the stored id can match an inbound reply's
     * In-Reply-To, so storing the wrong one is a routing failure that surfaces
     * as a reply opening a second conversation.
     */
    describe('which Message-ID is recorded', () => {
      beforeEach(() => {
        isPrincipalOnline.mockResolvedValue(false)
        visitorRows = [{ type: 'user', email: 'account@x.com' }]
        priorOutboundMessageIds.mockResolvedValue([])
      })

      const reply = () =>
        notifyAgentReply({
          conversationId,
          visitorPrincipalId,
          content: 'answer',
          agentName: 'Agent',
          channel: 'messenger',
        })

      it('records the id we minted when the transport does not report one', async () => {
        // No `messageId` key at all: the transport took the header we set, so
        // the minted id is what went out and what a reply will quote.
        sendConversationMessageEmail.mockResolvedValue({ sent: true })

        await reply()

        const minted = sendConversationMessageEmail.mock.calls[0][0].messageId
        expect(minted).toMatch(/^c\.1\./)
        expect(recordOutboundEmail).toHaveBeenCalledWith(minted, conversationId)
      })

      it("records the transport's id when it generated and reported its own", async () => {
        // The minted id never left: a transport that owns Message-ID strips
        // ours. Storing it would store an id that exists nowhere.
        sendConversationMessageEmail.mockResolvedValue({
          sent: true,
          messageId: 'cf-assigned-1@mx.cloudflare.net',
        })

        await reply()

        expect(sendConversationMessageEmail.mock.calls[0][0].messageId).toMatch(/^c\.1\./)
        expect(recordOutboundEmail).toHaveBeenCalledWith(
          'cf-assigned-1@mx.cloudflare.net',
          conversationId
        )
      })

      it('records nothing when the transport generated an id it did not disclose', async () => {
        // Explicit null is not "no id was set", it is "an id was set and we do
        // not know it". Nothing can be stored, and falling back to the minted id
        // would guarantee every Message-ID lookup for this mail misses.
        sendConversationMessageEmail.mockResolvedValue({ sent: true, messageId: null })

        await reply()

        expect(sendConversationMessageEmail.mock.calls[0][0].messageId).toMatch(/^c\.1\./)
        expect(recordOutboundEmail).not.toHaveBeenCalled()
        // The recipient identity is still recorded: the mail did go out.
        expect(recordEmailIdentity).toHaveBeenCalled()
      })
    })
  })
})
