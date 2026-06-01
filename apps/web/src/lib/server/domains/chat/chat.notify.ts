/**
 * Offline notifications for live chat. Fire-and-forget from the service after a
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
import { resolveReplyRecipient } from './chat.recipient'
import { inboundReplyToAddress, isEmailInboundConfigured } from './chat.email-channel'
import { getWatchersForConversation } from './chat.query'
import { mergeChatRecipients } from './chat.recipients'

const previewOf = (content: string) => truncate(content, 140)

/** Notify the team + any watchers of a new visitor message. */
export async function notifyVisitorMessage(opts: {
  conversation: Conversation
  content: string
  authorName: string
  isFirstMessage: boolean
}): Promise<void> {
  try {
    const agentsOnline = await isAnyAgentOnline()
    // The broad team ping is rate-limited (first message, or nobody online).
    // Watchers opted into THIS conversation, so they're always notified.
    const pingTeam = opts.isFirstMessage || !agentsOnline

    const [team, watchers] = await Promise.all([
      pingTeam
        ? db
            .select({ principalId: principal.id, email: user.email, name: user.name })
            .from(principal)
            .leftJoin(user, eq(principal.userId, user.id))
            .where(inArray(principal.role, ['admin', 'member']))
        : Promise.resolve(
            [] as Array<{ principalId: PrincipalId; email: string | null; name: string | null }>
          ),
      getWatchersForConversation(opts.conversation.id),
    ])

    // Union + dedupe so a watcher who is also in the broad team isn't doubled.
    const recipients = mergeChatRecipients(team, watchers)
    if (recipients.length === 0) return

    const title = `New chat message from ${opts.authorName}`
    const body = previewOf(opts.content)

    await createNotificationsBatch(
      recipients.map((r) => ({
        principalId: r.principalId as PrincipalId,
        type: 'chat_message' as const,
        title,
        body,
        metadata: { conversationId: opts.conversation.id },
      }))
    )

    // Email recipients only when no agent is online to handle it live.
    if (!agentsOnline) {
      const ctx = await buildHookContext()
      if (!ctx) return
      const ctaUrl = `${ctx.portalBaseUrl}/admin/chat?conversation=${opts.conversation.id}`
      const { sendChatMessageEmail } = await import('@quackback/email')
      await Promise.allSettled(
        recipients
          .filter((r) => r.email)
          .map((r) =>
            sendChatMessageEmail({
              to: r.email!,
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
    console.warn('[chat:notify] notifyVisitorMessage failed:', (err as Error).message)
  }
}

/**
 * Notify mentioned teammates of an internal note. Mentions are matched
 * deterministically against the email local-part (`@jane.doe` → jane.doe@…),
 * so a non-matching `@token` is just plain text and never mis-notifies.
 */
export async function notifyNoteMentions(opts: {
  conversationId: ConversationId
  content: string
  authorPrincipalId: PrincipalId
  authorName: string
}): Promise<void> {
  try {
    // Require the @ to start a token (line start or whitespace) so a pasted
    // email like "billing@jane.doe" doesn't read its domain as a mention.
    const tokens = [...opts.content.matchAll(/(?:^|\s)@([\w.+-]{2,})/g)].map((m) =>
      m[1].toLowerCase()
    )
    if (tokens.length === 0) return
    const wanted = new Set(tokens)

    const team = await db
      .select({ principalId: principal.id, email: user.email })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(inArray(principal.role, ['admin', 'member']))

    const recipients = team.filter((t) => {
      if (!t.email || t.principalId === opts.authorPrincipalId) return false
      const localPart = t.email.split('@')[0]?.toLowerCase()
      return localPart ? wanted.has(localPart) : false
    })
    if (recipients.length === 0) return

    await createNotificationsBatch(
      recipients.map((r) => ({
        principalId: r.principalId,
        type: 'chat_mention' as const,
        title: `${opts.authorName} mentioned you in a chat`,
        body: previewOf(opts.content),
        metadata: { conversationId: opts.conversationId },
      }))
    )
  } catch (err) {
    console.warn('[chat:notify] notifyNoteMentions failed:', (err as Error).message)
  }
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
      console.warn(
        `[chat:notify] agent reply undeliverable (no email) for conversation ${opts.conversationId}`
      )
      return
    }

    const ctx = await buildHookContext()
    if (!ctx) return
    const { sendChatMessageEmail } = await import('@quackback/email')
    const { mintConversationResumeToken } = await import('@/lib/server/realtime/chat-resume-token')
    // Deep-link via a signed, expiring resume token so the link works on a fresh
    // device (cross-device resume). The /chat/resume route verifies the token
    // before surfacing the thread — the token is the capability, not the URL.
    const token = mintConversationResumeToken(opts.conversationId, opts.visitorPrincipalId)
    const ctaUrl = `${ctx.portalBaseUrl.replace(/\/$/, '')}/api/chat/resume?token=${encodeURIComponent(token)}`
    // Only advertise a reply address we can actually receive on, so a visitor's
    // email reply threads back into this conversation (inbound email channel).
    const replyTo = isEmailInboundConfigured()
      ? (inboundReplyToAddress(opts.conversationId) ?? undefined)
      : undefined
    const result = await sendChatMessageEmail({
      to: recipient,
      direction: 'agent_reply',
      senderName: opts.agentName,
      messagePreview: previewOf(opts.content),
      ctaUrl,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      replyTo,
    })
    if (result && result.sent === false) {
      console.warn(
        `[chat:notify] agent-reply email not sent (provider returned sent:false) for conversation ${opts.conversationId}`
      )
    }
  } catch (err) {
    console.warn('[chat:notify] notifyAgentReply failed:', (err as Error).message)
  }
}
