/**
 * The centered, muted notice for an author-less 'system' thread event (chat
 * ended/reopened, assignment, assistant handoff, ticket created, ticket
 * status changed) — the status-line idiom shared by every customer-facing
 * thread: the messenger (`VisitorConversationThread`'s system row), the
 * portal ticket thread, and the widget ticket detail. One component so the
 * three surfaces localize the same kinds identically and can't drift.
 *
 * The notice text is ALWAYS localized client-side from the structured
 * `metadata.systemEvent` — never the stored `content`, which is only the
 * English fallback for legacy rows (pre-systemEvent data) and unknown kinds
 * (and for agent surfaces / email transcripts, which render `content` raw).
 * A known kind with its payload missing degrades to the same fallback rather
 * than rendering a half-filled sentence.
 *
 * Kinds and copy:
 *  - chat_ended / chat_reopened / assigned / assistant_handoff — the
 *    messenger's original four (copy unchanged).
 *  - ticket_created (B17) — the create-ticket flow's conversion marker on the
 *    converged shared thread: "Ticket #N created from this
 *    conversation". The visitor it renders for is the ticket's own requester.
 *  - ticket_status_changed (B25) — a public-stage crossing: "Status updated
 *    to {stageLabel}" (the label is the write-time workspace label, a
 *    workspace string, not UI chrome). With `closed: true` (B22) it is the
 *    generic-close projection instead: "Ticket closed" — posted when a
 *    null-`publicStage` status ("Won't do", "Duplicate") closes the ticket,
 *    so the customer hears the close without the internal status name.
 *
 * Workflow attribution: when the stored event carries `workflowName` (the
 * notice was posted by a workflow run, stamped server-side), the notice gains
 * a trailing "· via {workflowName}" so the thread names the automation that
 * fired it. The name is a workspace string (the workflow's display name),
 * rendered verbatim like the ticket stage label.
 */
import { FormattedMessage } from 'react-intl'
import type { ReactNode } from 'react'
import type { ConversationSystemEvent } from '@/lib/shared/conversation/types'

/** The localized sentence for a known kind, or null to fall back to content. */
function noticeText(event: ConversationSystemEvent): ReactNode {
  switch (event.kind) {
    case 'chat_ended':
      return (
        <FormattedMessage id="widget.messenger.system.ended" defaultMessage="Conversation ended" />
      )
    case 'chat_reopened':
      return (
        <FormattedMessage
          id="widget.messenger.system.reopened"
          defaultMessage="Conversation reopened"
        />
      )
    case 'assigned':
      return (
        <FormattedMessage
          id="widget.messenger.system.assigned"
          defaultMessage="Assigned to {name}"
          values={{ name: event.agentName ?? 'an agent' }}
        />
      )
    case 'assistant_handoff':
      return (
        <FormattedMessage
          id="widget.messenger.system.handoff"
          defaultMessage="Connecting you to the team"
        />
      )
    case 'ticket_created':
      if (!event.ticketReference) return null
      return (
        <FormattedMessage
          id="widget.messenger.system.ticketCreated"
          defaultMessage="Ticket {reference} created from this conversation"
          values={{ reference: event.ticketReference }}
        />
      )
    case 'ticket_status_changed':
      if (event.closed) {
        return (
          <FormattedMessage
            id="widget.messenger.system.ticketClosed"
            defaultMessage="Ticket closed"
          />
        )
      }
      if (!event.stageLabel) return null
      return (
        <FormattedMessage
          id="widget.messenger.system.ticketStatus"
          defaultMessage="Status updated to {stageLabel}"
          values={{ stageLabel: event.stageLabel }}
        />
      )
    default:
      return null
  }
}

export function SystemEventNotice({
  event,
  fallback,
}: {
  /** The structured event from `metadata.systemEvent`; null on legacy rows. */
  event: ConversationSystemEvent | null
  /** The stored (English) content — rendered only for legacy/unknown kinds. */
  fallback: string
}) {
  const notice = (event && noticeText(event)) ?? fallback
  const workflowName = event?.workflowName?.trim()
  return (
    <div className="flex items-center gap-2 py-1" role="status">
      <span className="h-px flex-1 bg-border/50" />
      <span className="text-center text-[11px] text-muted-foreground">
        {notice}
        {workflowName ? (
          <>
            {' · '}
            <FormattedMessage
              id="widget.messenger.system.viaWorkflow"
              defaultMessage="via {workflowName}"
              values={{ workflowName }}
            />
          </>
        ) : null}
      </span>
      <span className="h-px flex-1 bg-border/50" />
    </div>
  )
}
