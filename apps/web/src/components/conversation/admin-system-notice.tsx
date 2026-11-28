/**
 * The team's wording of an author-less system row in the inbox thread, from
 * its structured `systemEvent` in the teammate's language. A kind is worded
 * only when the event carries every part of the stored sentence; otherwise
 * (a snooze's time, an external issue's provider, a legacy row with no event)
 * the stored English `content` is shown as it is. Like `content`, the notice
 * does not name the workflow that posted it.
 */
import type { IntlShape } from 'react-intl'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { useOptionalIntl } from '@/components/ui/use-optional-intl'

const M = {
  ended: { id: 'admin.inbox.systemNotice.ended', defaultMessage: 'Conversation ended' },
  reopened: { id: 'admin.inbox.systemNotice.reopened', defaultMessage: 'Conversation reopened' },
  issueClosed: { id: 'admin.inbox.systemNotice.issueClosed', defaultMessage: 'Issue closed' },
  issueReopened: { id: 'admin.inbox.systemNotice.issueReopened', defaultMessage: 'Issue reopened' },
  assigned: {
    id: 'admin.inbox.systemNotice.assigned',
    defaultMessage: 'Conversation assigned to {name}',
  },
  teamAssigned: {
    id: 'admin.inbox.systemNotice.teamAssigned',
    defaultMessage: 'Conversation assigned to the {team} team',
  },
  handoff: { id: 'admin.inbox.systemNotice.handoff', defaultMessage: 'Connecting you to the team' },
  stage: { id: 'admin.inbox.systemNotice.stage', defaultMessage: 'Status updated to {stage}' },
  ticketClosed: { id: 'admin.inbox.systemNotice.ticketClosed', defaultMessage: 'Ticket closed' },
  linked: {
    id: 'admin.inbox.systemNotice.linked',
    defaultMessage: 'Linked to tracker {reference}',
  },
  ticketCreated: {
    id: 'admin.inbox.systemNotice.ticketCreated',
    defaultMessage: 'Ticket {reference} created from this conversation',
  },
  internalTicketCreated: {
    id: 'admin.inbox.systemNotice.internalTicketCreated',
    defaultMessage: 'Internal ticket {reference} opened from this conversation',
  },
  expired: {
    id: 'admin.inbox.systemNotice.expired',
    defaultMessage: 'This request timed out before a teammate could review it.',
  },
  priority: {
    id: 'admin.inbox.systemNotice.priority',
    defaultMessage:
      '{name} changed the priority to {priority, select, none {none} low {low} medium {medium} high {high} urgent {urgent} other {{priority}}}',
  },
  csat: {
    id: 'admin.inbox.systemNotice.csat',
    defaultMessage: 'The customer rated this conversation {rating} out of 5',
  },
} as const

/** The worded notice, or null to show the stored content. */
export function systemNoticeText(
  intl: IntlShape,
  message: Pick<ConversationMessageDTO, 'systemEvent' | 'isInternal'>,
  issueThread: boolean
): string | null {
  const event = message.systemEvent
  if (!event) return null
  switch (event.kind) {
    case 'chat_ended':
      return intl.formatMessage(issueThread ? M.issueClosed : M.ended)
    case 'chat_reopened':
      return intl.formatMessage(issueThread ? M.issueReopened : M.reopened)
    case 'assigned':
      return event.agentName ? intl.formatMessage(M.assigned, { name: event.agentName }) : null
    case 'team_assigned':
      return event.teamName ? intl.formatMessage(M.teamAssigned, { team: event.teamName }) : null
    case 'assistant_handoff':
      return intl.formatMessage(M.handoff)
    case 'ticket_status_changed':
      if (event.closed) return intl.formatMessage(M.ticketClosed)
      return event.stageLabel ? intl.formatMessage(M.stage, { stage: event.stageLabel }) : null
    case 'ticket_linked':
      return event.trackerReference
        ? intl.formatMessage(M.linked, { reference: event.trackerReference })
        : null
    case 'ticket_created':
      if (!event.ticketReference) return null
      return intl.formatMessage(message.isInternal ? M.internalTicketCreated : M.ticketCreated, {
        reference: event.ticketReference,
      })
    case 'assistant_action_expired':
      return intl.formatMessage(M.expired)
    case 'priority_changed':
      if (!event.agentName || !event.priority) return null
      return intl.formatMessage(M.priority, { name: event.agentName, priority: event.priority })
    case 'csat_submitted':
      return typeof event.rating === 'number'
        ? intl.formatMessage(M.csat, { rating: event.rating })
        : null
    default:
      return null
  }
}

export function AdminSystemNotice({
  message,
  issueThread = false,
}: {
  message: Pick<ConversationMessageDTO, 'systemEvent' | 'isInternal' | 'content'>
  /** The thread is an issue on a code host, whose close and reopen read "Issue …". */
  issueThread?: boolean
}) {
  const intl = useOptionalIntl()
  const text = systemNoticeText(intl, message, issueThread)
  return (
    <div className="flex items-center gap-2 py-1" role="status">
      <span className="h-px flex-1 bg-border/40" />
      <span className="whitespace-nowrap px-2 text-[11px] text-muted-foreground">
        {text ?? message.content}
      </span>
      <span className="h-px flex-1 bg-border/40" />
    </div>
  )
}
