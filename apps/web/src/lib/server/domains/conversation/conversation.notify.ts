/**
 * Offline notifications for support-inbox conversations. Fire-and-forget from the service after a
 * write commits — a delivery failure must never break sending a message.
 *
 *  - Visitor message  -> in-app notification for the team; email the team only
 *    when no agent currently has a live stream (offline coverage).
 *  - Agent reply      -> email the visitor only when they're offline AND
 *    identified (anonymous visitors have no deliverable address; the widget's
 *    unread badge covers the online case).
 */
import { db, eq, inArray, principal, user } from '@/lib/server/db'
import type { Conversation } from '@/lib/server/db'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import { isAnyAgentOnline, isPrincipalOnline } from '@/lib/server/realtime/presence'
import { createNotificationsBatch } from '@/lib/server/domains/notifications/notification.service'
import { buildHookContext } from '@/lib/server/events/hook-context'
import { truncate } from '@/lib/shared/utils/string'
import { resolveReplyRecipient } from './conversation.recipient'
import {
  inboundReplyToAddress,
  isEmailInboundConfigured,
  mintOutboundMessageId,
} from './conversation.email-channel'
import {
  priorOutboundMessageIds,
  recordOutboundEmail,
  recordEmailIdentity,
} from './conversation.email-store'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-notify' })

const previewOf = (content: string) => truncate(content, 140)

/**
 * Threading headers for a visitor-facing conversation email: a fresh
 * deterministic Message-ID plus the References chain from prior outbound mails
 * (so mail clients thread the conversation, and a reply that strips the
 * plus-address still routes home via In-Reply-To/References). Absent when no
 * sending domain is configured.
 */
async function outboundThreading(conversationId: ConversationId): Promise<{
  messageId?: string
  inReplyTo?: string
  references?: string[]
}> {
  const messageId = mintOutboundMessageId(conversationId)
  if (!messageId) return {}
  const prior = await priorOutboundMessageIds(conversationId)
  return {
    messageId,
    inReplyTo: prior[prior.length - 1],
    references: prior.length > 0 ? prior : undefined,
  }
}

/**
 * Where a conversation email deep-links to for the VISITOR: the portal Support
 * thread when that surface is enabled, else the widget's `?c=` deep link. Pure
 * so the selection is unit-tested directly.
 */
export function visitorConversationLink(
  portalBaseUrl: string,
  conversationId: ConversationId,
  portalSupportEnabled: boolean
): string {
  const base = portalBaseUrl.replace(/\/$/, '')
  return portalSupportEnabled
    ? `${base}/support/${encodeURIComponent(conversationId)}`
    : `${base}/widget/?c=${encodeURIComponent(conversationId)}`
}

/** Resolve the visitor-facing conversation link with the current gate state. */
async function resolveVisitorConversationLink(
  portalBaseUrl: string,
  conversationId: ConversationId
): Promise<string> {
  const { isPortalSupportEnabled } = await import('@/lib/server/domains/settings/settings.support')
  return visitorConversationLink(portalBaseUrl, conversationId, await isPortalSupportEnabled())
}

/** Notify the team of a new visitor message. */
export async function notifyVisitorMessage(opts: {
  conversation: Conversation
  content: string
  authorName: string
  isFirstMessage: boolean
}): Promise<void> {
  try {
    const agentsOnline = await isAnyAgentOnline()
    // Avoid notification spam: only ping the team on the first message of a
    // conversation, or when nobody is around to see it live.
    if (!opts.isFirstMessage && agentsOnline) return

    const team = await db
      .select({ principalId: principal.id, email: user.email, name: user.name })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(inArray(principal.role, ['admin', 'member']))

    if (team.length === 0) return

    const title = `New message from ${opts.authorName}`
    const body = previewOf(opts.content)

    await createNotificationsBatch(
      team.map((t) => ({
        principalId: t.principalId,
        type: 'chat_message' as const,
        title,
        body,
        metadata: { conversationId: opts.conversation.id },
      }))
    )

    // Email the team only when no agent is online to handle it live.
    if (!agentsOnline) {
      const ctx = await buildHookContext()
      if (!ctx) return
      const ctaUrl = `${ctx.portalBaseUrl.replace(/\/$/, '')}/admin/inbox?c=${opts.conversation.id}`
      const { sendConversationMessageEmail } = await import('@quackback/email')
      await Promise.allSettled(
        team
          .filter((t) => t.email)
          .map((t) =>
            sendConversationMessageEmail({
              to: t.email!,
              direction: 'visitor_message',
              senderName: opts.authorName,
              messagePreview: body,
              ctaUrl,
              workspaceName: ctx.workspaceName,
              logoUrl: ctx.logoUrl ?? undefined,
            })
          )
      )
    }
  } catch (err) {
    log.warn({ err }, 'notify visitor message failed')
  }
}

/**
 * Send one visitor-facing conversation email (an agent reply or an agent-started
 * thread) and record its threading id + the recipient's channel identity, so a
 * future email reply routes back and cold inbound resolves the address to the
 * visitor. The two callers differ only in `direction`.
 */
async function sendVisitorConversationEmail(opts: {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
  recipient: string
  direction: 'agent_reply' | 'agent_started'
  senderName: string
  content: string
  ctaUrl: string
  ctx: { workspaceName: string; logoUrl: string | null }
}): Promise<void> {
  // Only advertise a reply address we can actually receive on, so a visitor's
  // email reply threads back into this conversation (inbound email channel).
  const replyTo = isEmailInboundConfigured()
    ? (inboundReplyToAddress(opts.conversationId) ?? undefined)
    : undefined
  const threading = await outboundThreading(opts.conversationId)
  const { sendConversationMessageEmail } = await import('@quackback/email')
  const result = await sendConversationMessageEmail({
    to: opts.recipient,
    direction: opts.direction,
    senderName: opts.senderName,
    messagePreview: previewOf(opts.content),
    ctaUrl: opts.ctaUrl,
    workspaceName: opts.ctx.workspaceName,
    logoUrl: opts.ctx.logoUrl ?? undefined,
    replyTo,
    ...threading,
  })
  if (result && result.sent === false) {
    log.warn(
      { conversation_id: opts.conversationId, direction: opts.direction },
      'conversation email not sent (provider returned sent:false)'
    )
  }
  await Promise.all([
    threading.messageId
      ? recordOutboundEmail(threading.messageId, opts.conversationId)
      : Promise.resolve(),
    recordEmailIdentity(opts.recipient, opts.visitorPrincipalId),
  ])
}

/**
 * Email an offline visitor when an agent replies. An identified visitor's
 * account email is preferred; an anonymous visitor is reachable only via the
 * pre-chat email they captured on the conversation.
 */
export async function notifyAgentReply(opts: {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
  content: string
  agentName: string
  /** Pre-chat email captured on the conversation, if any. */
  capturedEmail?: string | null
}): Promise<void> {
  try {
    if (await isPrincipalOnline(opts.visitorPrincipalId)) return

    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, opts.visitorPrincipalId))
      .limit(1)

    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, opts.capturedEmail)
    if (!recipient) {
      // The visitor is offline and unreachable — surface it instead of dropping
      // silently (the inbox can flag conversations with no reply-to address).
      log.warn({ conversation_id: opts.conversationId }, 'agent reply undeliverable (no email)')
      return
    }

    const ctx = await buildHookContext()
    if (!ctx) return
    // Deep-link to the visitor's conversation surface (portal Support thread
    // when enabled, else the widget messenger view). The thread is surfaced from
    // the visitor's own session (or a re-identify in the host app), so the URL
    // only navigates — it carries no capability of its own.
    const ctaUrl = await resolveVisitorConversationLink(ctx.portalBaseUrl, opts.conversationId)
    await sendVisitorConversationEmail({
      conversationId: opts.conversationId,
      visitorPrincipalId: opts.visitorPrincipalId,
      recipient,
      direction: 'agent_reply',
      senderName: opts.agentName,
      content: opts.content,
      ctaUrl,
      ctx,
    })
  } catch (err) {
    log.warn({ err }, 'notify agent reply failed')
  }
}

/**
 * Email the first message of an agent-STARTED conversation. Unlike a reply,
 * this always sends — a brand-new outbound conversation's recipient is, by
 * definition, not sitting in the thread, so presence is never consulted. The
 * service validated a deliverable email before creating the conversation; a
 * send failure here logs and never rolls the conversation back.
 */
export async function notifyConversationStarted(opts: {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
  content: string
  agentName: string
}): Promise<void> {
  try {
    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, opts.visitorPrincipalId))
      .limit(1)

    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, null)
    if (!recipient) {
      log.warn(
        { conversation_id: opts.conversationId },
        'outbound message undeliverable (no email)'
      )
      return
    }

    const ctx = await buildHookContext()
    if (!ctx) return
    const ctaUrl = await resolveVisitorConversationLink(ctx.portalBaseUrl, opts.conversationId)
    await sendVisitorConversationEmail({
      conversationId: opts.conversationId,
      visitorPrincipalId: opts.visitorPrincipalId,
      recipient,
      direction: 'agent_started',
      senderName: opts.agentName,
      content: opts.content,
      ctaUrl,
      ctx,
    })
  } catch (err) {
    log.warn({ err }, 'notify conversation started failed')
  }
}
