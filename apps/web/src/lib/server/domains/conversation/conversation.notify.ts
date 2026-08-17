/**
 * Offline notifications for support-inbox conversations. Fire-and-forget from the service after a
 * write commits — a delivery failure must never break sending a message.
 *
 * Because it is fire-and-forget, a failed send has no caller to surface it: the
 * message row is already committed and the thread already renders it as sent. So
 * visitor-facing sends go through a small bounded retry (see sendWithRetry) to
 * convert the common transient provider failure into a success rather than a log
 * line nobody reads. A send that exhausts the retries is still only logged.
 *
 *  - Visitor message  -> email the team only when no agent currently has a
 *    live stream (offline coverage). The in-app team bell for the same
 *    event rides the message.created event/hook pipeline instead (WO-3
 *    slice 5) — see notifyVisitorMessage's own doc.
 *  - Agent reply      -> email the visitor when they're reachable AND either
 *    offline OR on an EMAIL conversation. Presence gates the messenger surface
 *    only: on an email thread the mailbox IS the thread, so a live stream
 *    elsewhere is no evidence the reply was seen (see notifyAgentReply). An
 *    anonymous visitor with no captured address stays unreachable either way.
 */
import {
  db,
  eq,
  inArray,
  desc,
  and,
  isNull,
  principal,
  user,
  conversations,
  conversationMessages,
} from '@/lib/server/db'
import {
  formatNamedSendingAddress,
  resolveConversationFrom,
} from '@/lib/server/domains/channel-accounts/channel-account.service'
import type { Conversation } from '@/lib/server/db'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/core'
import { generateContentHTML } from '@/lib/shared/content-html'
import { withEmailProxyHint } from '@/lib/server/content/email-image-proxy'
import { isAnyAgentOnline, isPrincipalOnline } from '@/lib/server/realtime/presence'
import { buildHookContext } from '@/lib/server/events/hook-context'
import { truncate } from '@/lib/shared/utils/string'
import { resolveReplyRecipient } from './conversation.recipient'
import {
  inboundReplyToAddress,
  isEmailInboundConfigured,
  mintOutboundMessageId,
} from './conversation.email-channel'
import { currentMailSlug } from './conversation.mail-slug'
import {
  threadIdsForOutbound,
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
 * deterministic Message-ID plus the References chain of prior outbound ids
 * AND the customer's inbound Message-IDs (so the reply joins the thread they
 * started). In-Reply-To is the latest inbound id when one exists, else the
 * latest outbound. Absent when no sending domain is configured.
 */
async function outboundThreading(conversationId: ConversationId): Promise<{
  messageId?: string
  inReplyTo?: string
  references?: string[]
}> {
  const messageId = mintOutboundMessageId(conversationId)
  if (!messageId) return {}
  const thread = await threadIdsForOutbound(conversationId)
  const inReplyTo = thread.inbound.at(-1) ?? thread.outbound.at(-1)
  return {
    messageId,
    inReplyTo,
    references: thread.merged.length > 0 ? thread.merged : undefined,
  }
}

async function loadQuotedPreviousMessage(
  conversationId: ConversationId
): Promise<{ date: Date; name: string; text: string } | null> {
  const rows = await db
    .select({
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
      senderType: conversationMessages.senderType,
      name: user.name,
    })
    .from(conversationMessages)
    .leftJoin(principal, eq(conversationMessages.principalId, principal.id))
    .leftJoin(user, eq(principal.userId, user.id))
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        eq(conversationMessages.isInternal, false)
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(2)

  const previous = rows[1]
  if (!previous?.content) return null
  const name = previous.name?.trim() || (previous.senderType === 'agent' ? 'Support' : 'Customer')
  return { date: previous.createdAt, name, text: previous.content }
}

async function loadConversationMailContext(conversationId: ConversationId): Promise<{
  subject: string | null
  channel: Conversation['channel'] | undefined
}> {
  const [conv] = await db
    .select({
      subject: conversations.subject,
      channel: conversations.channel,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return { subject: conv?.subject ?? null, channel: conv?.channel }
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

/**
 * Email the team of a new visitor message when no agent is online to see it
 * live. The in-app team bell for the same event moved to the
 * `message.created` event/hook pipeline (WO-3 slice 5, notificationHook in
 * events/handlers/notification.ts) — this function is now email-only.
 */
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
    // Avoid email spam: only email the team on the first message of a
    // conversation, or when nobody is around to see it live. This gate is
    // redundant with the `!agentsOnline` check below for every case except
    // the fast escape it buys (skip the team query entirely) — kept exactly
    // as it was before the bell moved out, to not perturb email behavior.
    //
    // Deliberate small skew: presence is now checked at TWO different
    // moments — here, at request time, for the email; and again inside the
    // notification hook, at worker time, for the bell (its own anti-spam
    // gate: `!cfg.isFirstMessage && isAnyAgentOnline()`). Never try to unify
    // them — the bell's check intentionally runs later, off the request path.
    if (!opts.isFirstMessage && agentsOnline) return

    const team = await db
      .select({
        principalId: principal.id,
        email: user.email,
        contactEmail: principal.contactEmail,
        name: user.name,
      })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(inArray(principal.role, ['admin', 'member']))

    if (team.length === 0) return

    const body = previewOf(opts.content)

    // Email the team only when no agent is online to handle it live.
    if (!agentsOnline) {
      const ctx = await buildHookContext()
      if (!ctx) return
      const ctaUrl = `${ctx.portalBaseUrl.replace(/\/$/, '')}/admin/inbox?i=${opts.conversation.id}`
      const { sendConversationMessageEmail } = await import('@quackback/email')
      // Contact class: the only link is an /admin/inbox URL, which carries no
      // capability — the session does. So a teammate reachable only via their
      // contact address is correctly included, which the old truthiness filter
      // on the account address would have dropped.
      // Both address fields came back with the team query, so the recipient is
      // decided from rows already in hand rather than by a second round trip.
      const { contactRecipientFrom, mailContact } = await import('@/lib/server/email/recipient')
      await Promise.allSettled(
        team
          .flatMap((t) => {
            const to = contactRecipientFrom({ accountEmail: t.email, contactEmail: t.contactEmail })
            return to ? [{ ...t, to }] : []
          })
          .map((t) =>
            mailContact(sendConversationMessageEmail, t.to, {
              direction: 'visitor_message',
              senderName: opts.authorName,
              messagePreview: body,
              bodyHtml: messageBodyHtml(opts.content, opts.contentJson),
              ctaUrl,
              workspaceName: ctx.workspaceName,
              logoUrl: ctx.logoUrl ?? undefined,
              isFirstMessage: opts.isFirstMessage,
              conversationSubject: opts.conversation.subject,
            })
          )
      )
    }
  } catch (err) {
    log.warn({ err }, 'notify visitor message failed')
  }
}

/**
 * Backoff before each RETRY of a conversation-email send, in milliseconds — so a
 * two-entry list means up to three attempts. Exported so tests can shrink it;
 * nothing else should read it.
 */
export const EMAIL_SEND_RETRY_DELAYS_MS = [2000, 4000]

/**
 * Has this error positively declared that re-sending reproduces it?
 *
 * Opt-in, and absence means "retry". Only a transport knows which of its own
 * failures are about the moment and which are about the message — a From on a
 * domain the provider is not authorized to send as is the same rejection every
 * time — so the transport says so and this honours it, without anything here
 * having to hold a per-provider error taxonomy.
 */
function declaresPermanentFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'retryable' in err &&
    (err as { retryable: unknown }).retryable === false
  )
}

/**
 * Send with a small bounded retry. The email dispatch layer THROWS on any
 * provider error, and this whole path is fire-and-forget behind a `void` call
 * whose catch only logs — so without a retry a thirty-second provider blip
 * silently loses an agent's reply, while the message row is committed and the
 * thread renders it as sent.
 *
 * Retries by default rather than classifying which errors are transient. A
 * per-provider error taxonomy has to be hand-maintained and fails CLOSED: the
 * day the provider adds an error name, an allow-list quietly stops retrying it.
 * Two wasted calls on a genuinely terminal failure is by far the cheaper
 * mistake. The one exception is an error that declares its own permanence — a
 * transport saying "this message is wrong" rather than "not right now" — which
 * costs nothing to honour because the default stays retry for everything that
 * says nothing.
 *
 * The caller mints the threading headers ONCE, above this, so a Message-ID
 * minted per attempt cannot make a provider that errors after accepting deliver
 * two mails that neither dedupe in the client nor thread together. That holds
 * only on the transports where WE own the Message-ID. On one that generates its
 * own and rejects a caller-supplied header, every attempt necessarily carries a
 * different id, so the transport reopens that window whatever this loop does:
 * only the id of the attempt that RETURNS is recorded, and a mail delivered by
 * an earlier attempt is unroutable by Message-ID. Not retrying an error that
 * declares itself permanent is what narrows the window here, and what keeps a
 * duplicate merely a duplicate rather than a second conversation is the
 * plus-addressed Reply-To: it is per conversation, so it is identical on every
 * attempt and routes a reply to either copy into the same thread.
 */
async function sendWithRetry<T>(
  conversationId: ConversationId,
  send: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send()
    } catch (err) {
      const delay = EMAIL_SEND_RETRY_DELAYS_MS[attempt]
      // Out of budget, or an error that has already told us a second attempt
      // reproduces it: rethrow so the caller's own catch logs it as a failed
      // notification, exactly as it did before retries existed.
      if (delay === undefined || declaresPermanentFailure(err)) throw err
      log.warn(
        { err, conversation_id: conversationId, attempt: attempt + 1 },
        'conversation email send failed; retrying'
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
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
  channel?: Conversation['channel']
}): Promise<void> {
  // Only advertise a reply address we can actually receive on, so a visitor's
  // email reply threads back into this conversation (inbound email channel).
  // The mail slug is what makes an address routable on a shared inbound domain;
  // when there is none to mint under, no address is emitted at all and the mail
  // goes out with the portal footer as its only route back.
  const replyTo = isEmailInboundConfigured()
    ? (inboundReplyToAddress(opts.conversationId, currentMailSlug()) ?? undefined)
    : undefined
  const threading = await outboundThreading(opts.conversationId)
  const mailCtx = await loadConversationMailContext(opts.conversationId)
  const channel = opts.channel ?? mailCtx.channel
  const quotedPrevious =
    channel === 'email'
      ? ((await loadQuotedPreviousMessage(opts.conversationId)) ?? undefined)
      : undefined
  // Reply from the address the customer wrote to when this workspace has proved
  // it may send as that domain, else the assigned team's sending address, else
  // the branded workspace default (EMAIL_FROM). A thread that arrived at the
  // customer's own support address should not change identity on the way back.
  const resolvedFrom = (await resolveConversationFrom(opts.conversationId)) ?? undefined
  const fromDisplayName =
    channel === 'email' ? `${opts.senderName} (${opts.ctx.workspaceName})` : undefined
  const from =
    resolvedFrom && fromDisplayName
      ? formatNamedSendingAddress(resolvedFrom, fromDisplayName)
      : resolvedFrom
  const { sendConversationMessageEmail } = await import('@quackback/email')
  const result = await sendWithRetry(opts.conversationId, () =>
    sendConversationMessageEmail({
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
      fromDisplayName: from ? undefined : fromDisplayName,
      channel,
      conversationSubject: mailCtx.subject,
      quotedPrevious,
      ...threading,
    })
  )
  if (result && result.sent === false) {
    log.warn(
      { conversation_id: opts.conversationId, direction: opts.direction, reason: result.reason },
      'conversation email not sent'
    )
  }
  // Which Message-ID actually went out, which is not always the one we minted.
  // A transport that owns the header generates its own and reports it back, and
  // that reported id is the one a reply resolves against — not necessarily the
  // literal token it quotes, which the store reconciles. An explicit null means
  // it generated one it did not disclose, in which case there is nothing to
  // record and the plus-addressed Reply-To is the only route a reply has home.
  // Recording the minted id there would store an id that exists nowhere and
  // guarantee a miss.
  const outboundMessageId =
    result?.messageId === undefined ? threading.messageId : (result.messageId ?? undefined)
  await Promise.all([
    outboundMessageId
      ? recordOutboundEmail(outboundMessageId, opts.conversationId)
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
  /** The channel this conversation is currently conducted on. REQUIRED, not
   *  optional-with-a-default: a future caller that forgets it must fail to
   *  compile rather than silently default to 'messenger' and reinstate the
   *  presence-suppression bug this parameter exists to fix. */
  channel: Conversation['channel']
}): Promise<void> {
  try {
    // Presence gates the MESSENGER surface only. On an email conversation the
    // visitor's mailbox IS the thread, so a live SSE stream elsewhere (a portal
    // tab, the widget open on another page) is no evidence they will see this
    // reply — there the gate is an anti-spam optimisation, and here it simply
    // does not apply. Worst case an online email visitor gets the in-app copy
    // AND the mail, which is the right way round to be wrong: a duplicate beats
    // a silent drop.
    if (opts.channel !== 'email' && (await isPrincipalOnline(opts.visitorPrincipalId))) return

    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, opts.visitorPrincipalId))
      .limit(1)

    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, opts.capturedEmail)
    if (!recipient) {
      // The visitor is unreachable — surface it instead of dropping silently
      // (the inbox can flag conversations with no reply-to address). `channel`
      // discriminates the two severities: on messenger the widget's unread
      // badge still carries the reply, on email nothing does and it is lost.
      // No early return: on a group thread the participants may still be
      // reachable even when the primary visitor is not.
      log.warn(
        { conversation_id: opts.conversationId, channel: opts.channel },
        'agent reply undeliverable (no email)'
      )
    }

    const ctx = await buildHookContext()
    if (!ctx) return
    // Deep-link to the visitor's conversation surface (portal Support thread
    // when enabled, else the widget messenger view). The thread is surfaced from
    // the visitor's own session (or a re-identify in the host app), so the URL
    // only navigates — it carries no capability of its own.
    const ctaUrl = await resolveVisitorConversationLink(ctx.portalBaseUrl, opts.conversationId)
    if (recipient) {
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
        channel: opts.channel,
      })
    }

    // Group thread (§4.8): every added customer receives the reply too. One
    // participant's failure never eats the primary send (already delivered
    // above) nor the remaining participants. Participants always get the mail
    // — they have no widget session of their own on this thread, so their
    // mailbox IS the thread regardless of presence.
    try {
      const { listParticipantReplyRecipients } = await import('./conversation-participant.service')
      const participants = await listParticipantReplyRecipients(
        opts.conversationId,
        opts.visitorPrincipalId,
        recipient
      )
      for (const participant of participants) {
        try {
          await sendVisitorConversationEmail({
            conversationId: opts.conversationId,
            visitorPrincipalId: participant.principalId,
            recipient: participant.email,
            direction: 'agent_reply',
            senderName: opts.agentName,
            content: opts.content,
            contentJson: opts.contentJson,
            ctaUrl,
            ctx,
            channel: opts.channel,
          })
        } catch (err) {
          log.warn(
            { err, conversation_id: opts.conversationId, principal_id: participant.principalId },
            'participant reply email failed'
          )
        }
      }
    } catch (err) {
      log.warn({ err, conversation_id: opts.conversationId }, 'participant reply fan-out failed')
    }
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
 * conversation, conversation.email-cold-inbound.ts, and PROMOTED onto any thread
 * whose customer replies by mail — see sendVisitorMessage's channel write). The
 * in-app emoji row is inert in an email client,
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

    // The same From the thread's replies leave as. A rating prompt that arrived
    // from the platform address on a conversation answered from the customer's
    // own support address is a thread that changes identity halfway through,
    // which is exactly what a customer-owned sending domain is bought to avoid.
    const from = (await resolveConversationFrom(conversationId)) ?? undefined

    const { sendCsatRequestEmail } = await import('@quackback/email')
    await sendCsatRequestEmail({
      to: recipient,
      promptText,
      ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
      from,
    })
  } catch (err) {
    log.warn({ err, conversationId }, 'csat request email failed')
  }
}
