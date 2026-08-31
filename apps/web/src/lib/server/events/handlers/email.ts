/**
 * Email hook handler.
 * Sends email notifications to subscribers when events occur.
 */

import {
  sendStatusChangeEmail,
  sendNewCommentEmail,
  sendChangelogPublishedEmail,
  sendPostMentionEmail,
  sendStatusIncidentPublishedEmail,
  sendStatusMaintenanceScheduledEmail,
  sendTicketEventEmail,
  sendNoteMentionEmail,
} from '@quackback/email'
import type { EmailResult, IncidentImpact } from '@quackback/email'
import type { TicketId } from '@quackback/ids'
import type {
  HookHandler,
  HookResult,
  EmailTarget,
  EmailConfig,
  TicketEmailConfig,
  NoteMentionEmailConfig,
} from '../hook-types'
import type { EventData, EventPostMentionedData } from '../types'
import {
  ticketRootMessageId,
  mintTicketOutboundMessageId,
  noteThreadRootMessageId,
  mintNoteOutboundMessageId,
} from '@/lib/server/domains/conversation/conversation.email-channel'
import type { ConversationId } from '@quackback/ids'
import { isRetryableError } from '../hook-utils'
import { permittedSendingIdentity } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { logger } from '@/lib/server/logger'

/** The event types whose email is one of the seven ticket-lifecycle kinds. */
const TICKET_EMAIL_EVENT_TYPES = new Set<string>([
  'ticket.created',
  'ticket.replied',
  'ticket.status_changed',
  'ticket.assigned',
  'sla.approaching_breach',
  'sla.breached',
])

/**
 * Threading headers for a ticket email. The `created` confirmation IS the thread
 * root (its own Message-ID is the deterministic root id); every later ticket
 * email mints a fresh Message-ID and References the root, so a ticket's emails
 * collapse into one client conversation. SLA emails carry no ticket id (they're
 * conversation-scoped agent alerts) and so thread on nothing.
 *
 * These ids are what we ASK for, which is not always what goes out. A transport
 * that owns the Message-ID header replaces ours and reports back the id it
 * assigned, and this hook has nowhere to keep that id — there is no
 * ticket-scoped equivalent of the conversation threading map — so it is
 * discarded. Two consequences, neither of them a routing bug: a later ticket
 * email then References a root no client ever received, so on that transport
 * the mails do not collapse into one thread; and no ticket email is resolvable
 * by Message-ID. Nothing depends on the second, because a ticket reply routes
 * on its signed `+t` address alone (see conversation.email-inbound.service.ts),
 * never on this id.
 */
function ticketThreading(cfg: TicketEmailConfig): {
  messageId?: string
  inReplyTo?: string
  references?: string[]
} {
  if (!cfg.ticketId) return {}
  const ticketId = cfg.ticketId as TicketId
  const root = ticketRootMessageId(ticketId)
  if (cfg.kind === 'created') {
    // The root email threads on nothing above itself; keep the keys present
    // (value undefined) so the emitted param shape is uniform across kinds.
    return { messageId: root ?? undefined, inReplyTo: undefined, references: undefined }
  }
  return {
    messageId: mintTicketOutboundMessageId(ticketId) ?? undefined,
    inReplyTo: root ?? undefined,
    references: root ? [root] : undefined,
  }
}

/**
 * Threading headers for an internal-note @-mention alert. Each send mints its
 * own Message-ID and References the conversation's deterministic note-thread
 * root, so every mention on one conversation lands in a single thread in the
 * teammate's client instead of a stack of unrelated mails. The root lives in a
 * namespace of its own, disjoint from the customer-facing conversation ids, so
 * an internal alert never joins the thread the customer sees.
 *
 * Same caveat as {@link ticketThreading}: on a transport that assigns its own
 * Message-ID the minted id never reaches the wire and the assigned one is
 * discarded, so the alerts thread on a root no client received. Being
 * unroutable is the intended state here either way — the inbound map's
 * authority is the recorded customer-facing ids alone.
 */
function noteMentionThreading(cfg: NoteMentionEmailConfig): {
  messageId?: string
  inReplyTo?: string
  references?: string[]
} {
  if (!cfg.conversationId) return {}
  const conversationId = cfg.conversationId as ConversationId
  const root = noteThreadRootMessageId(conversationId)
  return {
    messageId: mintNoteOutboundMessageId(conversationId) ?? undefined,
    inReplyTo: root ?? undefined,
    references: root ? [root] : undefined,
  }
}

const log = logger.child({ component: 'email' })

const BROADCAST_EMAIL_EVENTS = new Set([
  'changelog.published',
  'status.incident_created',
  'status.maintenance_scheduled',
])

export const emailHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { email, unsubscribeUrl } = target as EmailTarget
    const cfg = config as EmailConfig

    log.debug({ event_type: event.type }, 'sending email notification')

    try {
      if (BROADCAST_EMAIL_EVENTS.has(event.type)) {
        const { emailBudgetAvailable } = await import('@/lib/server/domains/settings/tier-enforce')
        if (!(await emailBudgetAvailable())) {
          log.warn({ event_type: event.type }, 'email budget exhausted; broadcast skipped')
          return { success: true }
        }
      }

      let result: EmailResult

      if (event.type === 'post.status_changed') {
        result = await sendStatusChangeEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          previousStatus: cfg.previousStatus!,
          newStatus: cfg.newStatus!,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
        })
      } else if (event.type === 'comment.created') {
        result = await sendNewCommentEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          commenterName: cfg.commenterName!,
          commentPreview: cfg.commentPreview!,
          isTeamMember: cfg.isTeamMember ?? false,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
        })
      } else if (event.type === 'post.mentioned') {
        const data = event.data as EventPostMentionedData
        result = await sendPostMentionEmail({
          to: email,
          mentionerName: event.actor.displayName ?? '',
          postTitle: data.postTitle,
          excerpt: data.excerpt,
          postUrl: data.postUrl,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
        })
      } else if (event.type === 'conversation.note_mentioned') {
        const c = config as unknown as NoteMentionEmailConfig
        result = await sendNoteMentionEmail({
          to: email,
          authorName: c.authorName,
          preview: c.preview,
          conversationUrl: c.ctaUrl,
          workspaceName: c.workspaceName,
          preferencesUrl: c.preferencesUrl,
          logoUrl: c.logoUrl,
          ...noteMentionThreading(c),
        })
      } else if (event.type === 'changelog.published') {
        const changelogCfg = config as Record<string, unknown>
        result = await sendChangelogPublishedEmail({
          to: email,
          changelogTitle: changelogCfg.changelogTitle as string,
          changelogUrl: changelogCfg.changelogUrl as string,
          contentPreview: (changelogCfg.contentPreview as string) ?? '',
          contentHtml: (changelogCfg.contentHtml as string) ?? '',
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
          from:
            (await permittedSendingIdentity((changelogCfg.from as string | undefined) ?? null)) ??
            undefined,
        })
      } else if (event.type === 'status.incident_created') {
        const c = config as Record<string, unknown>
        result = await sendStatusIncidentPublishedEmail({
          to: email,
          incidentTitle: c.incidentTitle as string,
          impact: (c.impact as IncidentImpact) ?? 'none',
          statusLabel: c.statusLabel as string,
          body: (c.body as string) ?? '',
          affectedComponents:
            (c.affectedComponents as Array<{ name: string; status: string }>) ?? [],
          incidentUrl: c.incidentUrl as string,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl: unsubscribeUrl ?? '',
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
        })
      } else if (event.type === 'status.maintenance_scheduled') {
        const c = config as Record<string, unknown>
        result = await sendStatusMaintenanceScheduledEmail({
          to: email,
          maintenanceTitle: c.incidentTitle as string,
          body: (c.body as string) ?? '',
          startLabel: (c.scheduledStartLabel as string) ?? '',
          endLabel: (c.scheduledEndLabel as string) ?? '',
          affectedComponents: ((c.affectedComponents as Array<{ name: string }>) ?? []).map(
            (a) => a.name
          ),
          incidentUrl: c.incidentUrl as string,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl: unsubscribeUrl ?? '',
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
        })
      } else if (TICKET_EMAIL_EVENT_TYPES.has(event.type)) {
        // All six ticket/SLA event types map onto sendTicketEventEmail; the
        // per-recipient config already carries the copy `kind`, CTA, per-team
        // From, and reply-by-email Reply-To, so the hook only computes threading.
        const t = config as TicketEmailConfig
        // TicketEmailConfig's field names already match SendTicketEventEmailParams;
        // spread it plus the hook-computed threading (the extra `ticketId` the
        // config carries for threading is a harmless excess property).
        result = await sendTicketEventEmail({
          to: email,
          ...t,
          // Re-asked HERE rather than trusted from the payload. The target
          // builder resolved this address when the event was enqueued, and this
          // send happens after the queue, which may be minutes later and is
          // certainly after a re-check could have demoted the domain. Sending
          // is the moment the claim is made, so it is the moment the claim is
          // checked; the enqueue-time resolution stays because it decides
          // WHICH address to try, and this decides whether it may be used.
          from: (await permittedSendingIdentity(t.from ?? null)) ?? undefined,
          ...ticketThreading(t),
        })
      } else {
        return { success: false, error: `Unsupported event type: ${event.type}` }
      }

      if (!result.sent) {
        // Every `sent: false` is the system declining on purpose: an install
        // with no provider configured, or a refused synthetic anonymous
        // address. Neither is a hook failure. A send that was attempted and
        // went wrong throws instead, and is caught below.
        log.debug({ event_type: event.type, reason: result.reason }, 'email skipped, not sent')
        return { success: true }
      }

      log.info({ event_type: event.type }, 'email sent')
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, event_type: event.type }, 'email send failed')
      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}
