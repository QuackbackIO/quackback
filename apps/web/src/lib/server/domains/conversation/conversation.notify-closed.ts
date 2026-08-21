import { db, eq, and, conversations, emailLog, principal, user } from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { resolveReplyRecipient } from './conversation.recipient'
import { resolveConversationFrom } from '@/lib/server/domains/channel-accounts/channel-account.service'
import { formatNamedSendingAddress } from '@/lib/server/domains/channel-accounts/channel-account.service'
import {
  inboundReplyToAddress,
  isEmailInboundConfigured,
  mintOutboundMessageId,
} from './conversation.email-channel'
import { currentMailSlug } from './conversation.mail-slug'
import { recordOutboundEmail, threadIdsForOutbound } from './conversation.email-store'
import { visitorConversationLink } from './conversation.notify'
import { buildHookContext } from '@/lib/server/events/hook-context'
import { logger } from '@/lib/server/logger'
import { ensureEmailLogSink } from '@/lib/server/email/email-log.sink'

const log = logger.child({ component: 'conversation-notify-closed' })

/**
 * Visitor-facing close mail for the email channel. Called only through the
 * email adapter's deliverLifecycleEvent.
 */
export async function notifyConversationClosed(opts: {
  conversationId: ConversationId
  variant: 'closed' | 'auto_closed'
  closerPrincipalId?: PrincipalId | null
}): Promise<void> {
  try {
    ensureEmailLogSink()
    const [conv] = await db
      .select({
        id: conversations.id,
        channel: conversations.channel,
        subject: conversations.subject,
        visitorPrincipalId: conversations.visitorPrincipalId,
        visitorEmail: conversations.visitorEmail,
        endReason: conversations.endReason,
      })
      .from(conversations)
      .where(eq(conversations.id, opts.conversationId))
      .limit(1)
    if (!conv?.visitorPrincipalId) return
    if (conv.endReason === 'spam') return
    if (opts.closerPrincipalId && opts.closerPrincipalId === conv.visitorPrincipalId) return

    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, conv.visitorPrincipalId))
      .limit(1)
    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, conv.visitorEmail)
    if (!recipient) return

    const ctx = await buildHookContext()
    if (!ctx) return

    const { emailBudgetAvailable } = await import('@/lib/server/domains/settings/tier-enforce')
    if (!(await emailBudgetAvailable())) {
      log.warn(
        { conversation_id: opts.conversationId },
        'email budget exhausted; close mail skipped'
      )
      return
    }

    const { isPortalSupportEnabled } =
      await import('@/lib/server/domains/settings/settings.support')
    const ctaUrl = visitorConversationLink(
      ctx.portalBaseUrl,
      opts.conversationId,
      await isPortalSupportEnabled()
    )

    const replyTo = isEmailInboundConfigured()
      ? (inboundReplyToAddress(opts.conversationId, currentMailSlug()) ?? undefined)
      : undefined
    const messageId = mintOutboundMessageId(opts.conversationId)
    const thread = messageId ? await threadIdsForOutbound(opts.conversationId) : null
    const inReplyTo = thread?.inbound.at(-1) ?? thread?.outbound.at(-1)
    const references = thread && thread.merged.length > 0 ? thread.merged : undefined

    const resolvedFrom = (await resolveConversationFrom(opts.conversationId)) ?? undefined
    const fromDisplayName = ctx.workspaceName
    const from = resolvedFrom ? formatNamedSendingAddress(resolvedFrom, fromDisplayName) : undefined

    const includeCsat = await shouldAttachCsat(opts.conversationId)
    let ratingUrls: [string, string, string, string, string] | undefined
    if (includeCsat) {
      const { mintCsatEmailToken } = await import('./csat-email-token')
      const token = mintCsatEmailToken(opts.conversationId, conv.visitorPrincipalId)
      const base = `${ctx.portalBaseUrl.replace(/\/$/, '')}/csat?token=${encodeURIComponent(token)}`
      ratingUrls = [1, 2, 3, 4, 5].map((r) => `${base}&rating=${r}`) as [
        string,
        string,
        string,
        string,
        string,
      ]
    }

    const { sendConversationClosedEmail } = await import('@quackback/email')
    const result = await sendConversationClosedEmail({
      to: recipient,
      workspaceName: ctx.workspaceName,
      variant: opts.variant,
      conversationSubject: conv.subject ?? undefined,
      viewUrl: ctaUrl,
      ratingUrls,
      replyTo: replyTo ?? undefined,
      from: from ?? undefined,
      fromDisplayName: from ? undefined : fromDisplayName,
      messageId: messageId ?? undefined,
      inReplyTo: inReplyTo ?? undefined,
      references,
      conversationId: opts.conversationId,
    })
    const outboundMessageId =
      result?.messageId === undefined ? messageId : (result.messageId ?? undefined)
    if (outboundMessageId) await recordOutboundEmail(outboundMessageId, opts.conversationId)
  } catch (err) {
    log.warn({ err, conversationId: opts.conversationId }, 'notify conversation closed failed')
  }
}

async function shouldAttachCsat(conversationId: ConversationId): Promise<boolean> {
  const [existing] = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(eq(emailLog.conversationId, conversationId), eq(emailLog.emailType, 'CsatRequestEmail'))
    )
    .limit(1)
  return !existing
}
