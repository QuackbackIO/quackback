/**
 * Notification sink resolver (EVENTING-V2 WO-8c) — the per-user fan-out:
 * subscriber email + in-app, @-mentions, changelog subscribers, and status-page
 * subscribers, each with their own audience gating and the notification
 * preference matrix.
 *
 * This is the trickiest sink, so the transitional implementation DELEGATES to
 * the already-tested builders in targets.ts (via the reconstructed EventData +
 * hook context) rather than re-porting ~700 lines and risking a parity gap.
 * A later phase folds the builders in and retires the legacy module. See
 * to-legacy-event.ts for the actor-fidelity caveat.
 */
import { buildHookContext } from '../hook-context'
import { toLegacyEvent } from '../to-legacy-event'
import {
  SUBSCRIBER_EVENT_TYPES,
  MENTION_EVENT_TYPES,
  getSubscriberTargets,
  getMentionTargets,
  getChangelogSubscriberTargets,
  getStatusSubscriberTargets,
  getConversationAssignedTargets,
  getTicketAssignedTargets,
  getAssistantHandedOffTargets,
  getConversationNoteMentionedTargets,
  getTicketStatusChangedTargets,
  getTicketRepliedTargets,
  getTicketNoteAddedTargets,
  getTicketExternalStatusChangedTargets,
  getMessageCreatedTargets,
  getTicketCreatedEmailTargets,
  getTicketRepliedEmailTargets,
  getTicketResolvedEmailTargets,
  getTicketAssignedEmailTargets,
  getSlaEmailTargets,
} from '../targets'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'
import type { HookTarget } from '../hook-types'

const SUBSCRIBER_SET = new Set<string>(SUBSCRIBER_EVENT_TYPES)
const MENTION_SET = new Set<string>(MENTION_EVENT_TYPES)
/** Status publish events that drive the status-subscription fan-out. */
const STATUS_NOTIFY_SET = new Set<string>([
  'status.incident_created',
  'status.maintenance_scheduled',
])

/**
 * Support-inbox "bell" events: each resolves to at most one notification target
 * from the payload/DB (no hook context needed). One table, so `interestedIn` and
 * the resolve loop share a single source of truth — adding a bell is one entry,
 * not a Set line plus a branch that must stay aligned. (ticket.status_changed and
 * message.created were relocated onto these events on `next`.)
 */
type BellBuilder = (event: EventData) => Promise<HookTarget | null> | HookTarget | null
const BELL_BUILDERS: Record<string, BellBuilder> = {
  'conversation.assigned': getConversationAssignedTargets,
  'ticket.assigned': getTicketAssignedTargets,
  'assistant.handed_off': getAssistantHandedOffTargets,
  'conversation.note_mentioned': getConversationNoteMentionedTargets,
  'ticket.status_changed': getTicketStatusChangedTargets,
  'ticket.replied': getTicketRepliedTargets,
  'ticket.note_added': getTicketNoteAddedTargets,
  'ticket.external_status_changed': getTicketExternalStatusChangedTargets,
  'message.created': getMessageCreatedTargets,
}

/**
 * Ticket + SLA lifecycle EMAIL builders (support platform). Unlike the bells,
 * these fan out one `type: 'email'` target per recipient and need the hook
 * context (portalBaseUrl/workspaceName/logoUrl), so they're kept in their own
 * table — built once per resolve, shared by every matching builder. A type can
 * appear in both tables (ticket.replied → bell + email); their targets concat.
 */
type EmailBuilder = (event: EventData, context: HookContext) => Promise<HookTarget[]>
const TICKET_EMAIL_BUILDERS: Record<string, EmailBuilder> = {
  'ticket.created': getTicketCreatedEmailTargets,
  'ticket.replied': getTicketRepliedEmailTargets,
  'ticket.status_changed': getTicketResolvedEmailTargets,
  'ticket.assigned': getTicketAssignedEmailTargets,
  'sla.approaching_breach': getSlaEmailTargets,
  'sla.breached': getSlaEmailTargets,
}

export const notificationResolver: SinkResolver = {
  sink: 'notification',
  interestedIn(type: string): boolean {
    return (
      SUBSCRIBER_SET.has(type) ||
      MENTION_SET.has(type) ||
      STATUS_NOTIFY_SET.has(type) ||
      type in BELL_BUILDERS ||
      type in TICKET_EMAIL_BUILDERS
    )
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    const legacy = toLegacyEvent(event)
    const out: HookTarget[] = []

    // Subscriber/mention/status fan-outs and the ticket/SLA email builders all
    // need the hook context; the bells resolve a single recipient from the
    // payload/DB and don't. Build it ONCE, shared by every matching builder.
    const emailBuilder = TICKET_EMAIL_BUILDERS[event.type]
    const needsContext =
      SUBSCRIBER_SET.has(event.type) ||
      MENTION_SET.has(event.type) ||
      STATUS_NOTIFY_SET.has(event.type) ||
      Boolean(emailBuilder)

    if (needsContext) {
      const context = await buildHookContext()
      if (!context) throw new Error('Failed to build notification hook context')
      if (SUBSCRIBER_SET.has(event.type)) {
        out.push(
          ...(event.type === 'changelog.published'
            ? await getChangelogSubscriberTargets(legacy, context)
            : await getSubscriberTargets(legacy, context))
        )
      }
      if (MENTION_SET.has(event.type)) {
        out.push(...(await getMentionTargets(legacy, context)))
      }
      if (STATUS_NOTIFY_SET.has(event.type)) {
        out.push(...(await getStatusSubscriberTargets(legacy, context)))
      }
      if (emailBuilder) {
        out.push(...(await emailBuilder(legacy, context)))
      }
    }

    // Support-inbox bell (at most one target). `await` normalizes the one
    // synchronous builder (note-mention) alongside the async ones.
    const bell = BELL_BUILDERS[event.type]
    if (bell) {
      const t = await bell(legacy)
      if (t) out.push(t)
    }

    return out
  },
}
