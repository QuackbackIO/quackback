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
import { db, eq, inArray, principal, user, conversations } from '@/lib/server/db'
import { resolveSendingAddress } from '@/lib/server/domains/channel-accounts/channel-account.service'
import type { Conversation } from '@/lib/server/db'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/core'
import { config } from '@/lib/server/config'
import { generateContentHTML } from '@/lib/shared/content-html'
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

/** Escape a plain-text string for safe interpolation into HTML text content. */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Wrap plain-text message content in escaped <p> paragraphs — blank lines split
 * paragraphs, single newlines become <br>. This is the body for a message with
 * no rich contentJson, and it carries the FULL text (not the truncated subject
 * preview) so the email recipient reads the whole message inline.
 */
function plaintextBodyHtml(content: string): string {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (paragraphs.length === 0) return ''
  return paragraphs.map((p) => `<p>${escapeHtmlText(p).replace(/\r?\n/g, '<br>')}</p>`).join('')
}

const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])

/**
 * Rewrite self-origin `/api/storage/` image srcs to carry the route's `?email=1`
 * force-proxy hint. Without it the route answers with a 302 to a presigned S3
 * URL, which many mail clients refuse to follow; with it the asset is proxied
 * inline. `S3_PUBLIC_URL` srcs are already directly fetchable and are left
 * untouched, as is every foreign origin. Structural walk over a copy of the
 * doc — never a string replace over serialized content.
 */
function withEmailProxyHint(node: JSONContent): JSONContent {
  let next = node
  if (IMAGE_NODE_TYPES.has(node.type ?? '') && typeof node.attrs?.src === 'string') {
    try {
      const src = new URL(node.attrs.src, config.baseUrl)
      const sameOrigin = src.origin === new URL(config.baseUrl).origin
      if (
        sameOrigin &&
        src.pathname.startsWith('/api/storage/') &&
        !src.searchParams.has('email')
      ) {
        src.searchParams.set('email', '1')
        next = { ...node, attrs: { ...node.attrs, src: src.toString() } }
      }
    } catch {
      // Unparseable src: leave the node alone; the serializer drops unsafe URLs.
    }
  }
  if (!node.content) return next
  return { ...next, content: node.content.map(withEmailProxyHint) }
}

/**
 * The full message body as sanitized HTML for the conversation email: the rich
 * `contentJson` rendered through the shared JSON→HTML serializer when present
 * (text nodes are HTML-escaped by the serializer), else the plain-text content
 * wrapped in escaped paragraphs. Empty when there's nothing to render, in which
 * case the template falls back to its truncated preview quote.
 */
function messageBodyHtml(content: string, contentJson?: JSONContent | null): string {
  if (contentJson) return generateContentHTML(withEmailProxyHint(contentJson))
  return plaintextBodyHtml(content)
}

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
  /** Rich message body (TipTap doc) rendered inline in the email, when present. */
  contentJson?: JSONContent | null
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
        metadata: { conversationId: opts.conversation.id, actorName: opts.authorName },
      }))
    )

    // Email the team only when no agent is online to handle it live.
    if (!agentsOnline) {
      const ctx = await buildHookContext()
      if (!ctx) return
      const ctaUrl = `${ctx.portalBaseUrl.replace(/\/$/, '')}/admin/inbox?i=${opts.conversation.id}`
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
              bodyHtml: messageBodyHtml(opts.content, opts.contentJson),
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
  /** Rich message body (TipTap doc) rendered inline in the email, when present. */
  contentJson?: JSONContent | null
  ctaUrl: string
  ctx: { workspaceName: string; logoUrl: string | null }
}): Promise<void> {
  // Only advertise a reply address we can actually receive on, so a visitor's
  // email reply threads back into this conversation (inbound email channel).
  const replyTo = isEmailInboundConfigured()
    ? (inboundReplyToAddress(opts.conversationId) ?? undefined)
    : undefined
  const threading = await outboundThreading(opts.conversationId)
  // Send as the conversation's team sending address (§4.8) when configured, else
  // the branded workspace default (EMAIL_FROM).
  const [conv] = await db
    .select({ assignedTeamId: conversations.assignedTeamId })
    .from(conversations)
    .where(eq(conversations.id, opts.conversationId))
    .limit(1)
  const from = (await resolveSendingAddress(conv?.assignedTeamId ?? null)) ?? undefined
  const { sendConversationMessageEmail } = await import('@quackback/email')
  const result = await sendConversationMessageEmail({
    to: opts.recipient,
    direction: opts.direction,
    senderName: opts.senderName,
    // The truncated preview backs the subject/preheader; the full body is
    // carried by bodyHtml so the recipient reads the whole reply inline.
    messagePreview: previewOf(opts.content),
    bodyHtml: messageBodyHtml(opts.content, opts.contentJson),
    ctaUrl: opts.ctaUrl,
    workspaceName: opts.ctx.workspaceName,
    logoUrl: opts.ctx.logoUrl ?? undefined,
    replyTo,
    from,
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
  /** Rich message body (TipTap doc) rendered inline in the email, when present. */
  contentJson?: JSONContent | null
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
      contentJson: opts.contentJson,
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
  /** Rich message body (TipTap doc) rendered inline in the email, when present. */
  contentJson?: JSONContent | null
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
      contentJson: opts.contentJson,
      ctaUrl,
      ctx,
    })
  } catch (err) {
    log.warn({ err }, 'notify conversation started failed')
  }
}

/**
 * Email a dedicated CSAT rating-request when a workflow's `request_csat`
 * block posts on a conversation whose active channel is EMAIL
 * (`conversations.channel === 'email'` — set only for a cold-inbound email
 * conversation, conversation.email-cold-inbound.ts; the widget/messenger
 * channels never set it). The in-app emoji row is inert in an email client,
 * so this sends a parallel email with real, one-click emoji links
 * (packages/email's csat-request template) — action.executor.ts's send_block
 * csat case calls this (via a dynamic import, to keep the rarely-hit path out
 * of that module's static graph) right after posting the block in-app.
 *
 * Reuses this module's own "email the visitor offline" recipient resolution
 * (the same principal/user join + resolveReplyRecipient every notify*
 * function above uses) rather than a separate lookup living in the workflows
 * domain. `promptText` is the block's already-interpolated body, pre-rendered
 * to plain text by the caller (action.executor.ts owns the TipTap ->
 * text conversion for every block kind already; this module has no other
 * reason to depend on that).
 *
 * Best-effort by design, same contract as every other notify* function here:
 * a failure (no deliverable recipient, an email provider outage, ...) must
 * never fail the block send that already posted in-app, so every failure is
 * caught and logged rather than propagated.
 */
export async function notifyCsatRequestEmail(
  conversationId: ConversationId,
  promptText: string
): Promise<void> {
  try {
    const [conv] = await db
      .select({
        channel: conversations.channel,
        visitorPrincipalId: conversations.visitorPrincipalId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!conv || conv.channel !== 'email' || !conv.visitorPrincipalId) return
    const visitorPrincipalId = conv.visitorPrincipalId

    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, visitorPrincipalId))
      .limit(1)
    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, null)
    if (!recipient) return

    const ctx = await buildHookContext()
    if (!ctx) return

    const { mintCsatEmailToken } = await import('./csat-email-token')
    const token = mintCsatEmailToken(conversationId, visitorPrincipalId)
    const base = `${ctx.portalBaseUrl.replace(/\/$/, '')}/csat?token=${encodeURIComponent(token)}`
    const ratingUrls = [1, 2, 3, 4, 5].map((r) => `${base}&rating=${r}`) as [
      string,
      string,
      string,
      string,
      string,
    ]

    const { sendCsatRequestEmail } = await import('@quackback/email')
    await sendCsatRequestEmail({
      to: recipient,
      promptText,
      ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
    })
  } catch (err) {
    log.warn({ err, conversationId }, 'csat request email failed')
  }
}
