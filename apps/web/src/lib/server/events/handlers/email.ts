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
} from '@quackback/email'
import type { IncidentImpact } from '@quackback/email'
import type { TicketId } from '@quackback/ids'
import type {
  HookHandler,
  HookResult,
  EmailTarget,
  EmailConfig,
  TicketEmailConfig,
} from '../hook-types'
import type { EventData, EventPostMentionedData } from '../types'
import {
  ticketRootMessageId,
  mintTicketOutboundMessageId,
} from '@/lib/server/domains/conversation/conversation.email-channel'
import { isRetryableError } from '../hook-utils'
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

const log = logger.child({ component: 'email' })

export const emailHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { email, unsubscribeUrl } = target as EmailTarget
    const cfg = config as EmailConfig

    log.debug({ event_type: event.type }, 'sending email notification')

    try {
      let result: { sent: boolean }

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
      } else if (event.type === 'changelog.published') {
        const changelogCfg = config as Record<string, unknown>
        result = await sendChangelogPublishedEmail({
          to: email,
          changelogTitle: changelogCfg.changelogTitle as string,
          changelogUrl: changelogCfg.changelogUrl as string,
          contentPreview: (changelogCfg.contentPreview as string) ?? '',
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
          preferencesUrl: cfg.preferencesUrl,
          logoUrl: cfg.logoUrl,
          from: changelogCfg.from as string | undefined,
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
        result = await sendTicketEventEmail({ to: email, ...t, ...ticketThreading(t) })
      } else {
        return { success: false, error: `Unsupported event type: ${event.type}` }
      }

      if (!result.sent) {
        log.debug({ event_type: event.type }, 'email skipped, not configured')
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
