/**
 * SLA breach clocks, driven off the event bus (support platform §4.6). The lazy
 * breach evaluator reacts to two event types, with different actor gating per
 * branch:
 *
 *   - message.created settles response clocks, but ONLY on a teammate reply
 *     (senderType 'agent'): first response first, then the armed next-response
 *     cycle (if any) — the first reply never double-settles a clock the
 *     customer cycle hasn't armed yet. A VISITOR message does the opposite:
 *     it (re-)arms the next-response clock for the fresh customer-message
 *     cycle. Both are timed by the message's own createdAt, and the
 *     response clocks read the conversation's message rows, because the
 *     reactions run from queued jobs that can run late or out of order (see
 *     sla.messages.ts): the first response settles at the first reply, and
 *     the next-response cycles are rebuilt from the rows on every message
 *     reaction, so each answered cycle's outcome is logged once whichever
 *     reaction runs first.
 *   - conversation.status_changed brings the pause state up to date (a
 *     conversation is paused while snoozed) and settles time-to-close on a
 *     close, with NO actor check at all. This is intentional, not an
 *     oversight: a workflow action closing or snoozing a conversation moves
 *     these clocks exactly the same as a teammate doing it manually would —
 *     the policy's own pauseOnSnooze setting is what governs pause behavior,
 *     not who (or what) changed the status. Gating these on actor would mean
 *     a workflow's auto-close never settled time-to-close, silently leaving
 *     SLA clocks running on conversations that are actually done.
 *   - ticket.status_changed drives the ticket-side TTR clock
 *     (ticket-sla.service.ts): paused while the status is in the 'pending'
 *     CATEGORY, settled on entering 'closed'. The payload's
 *     previousStatus/newStatus are already status categories, not raw status
 *     names, so a pending -> pending lateral move between two distinct
 *     statuses neither pauses nor resumes. Same no-actor-check rule as the
 *     conversation case, and tracker cascades re-enter setTicketStatus per
 *     linked ticket, so each cascaded ticket's own stamp evaluates
 *     independently (a tracker itself can never carry a stamp —
 *     applySlaToTicket refuses them).
 *
 * All recorders are idempotent and no-op without an applied SLA, so this
 * can react to every matching event unconditionally. Deadlines that pass with
 * NO further event are caught by the per-minute sweep in
 * sla-breach-sweep-queue.ts; both paths share the breach-noted markers on the
 * stamp so each breach is logged exactly once.
 *
 * Pauses (snoozed conversations, pending tickets) are not driven by the
 * events one by one. Every reaction first reconciles the stamp's pause state
 * with the entity's history (sla.pause-reconcile.ts), so pause and resume
 * reactions that run late, out of order, retried or twice leave the stamp as
 * the in-order run does, and each settle judges its clock as it stood at the
 * settle (dueAsOf). A direct paused -> closed move is reconciled before the
 * close settles, so it settles against the pause-shifted deadline. A close
 * settles at the first close since the SLA was applied, from the status
 * changes, and a settled clock keeps the deadline it was judged against.
 *
 * recordSlaFromEvent lets its errors propagate. It runs from the
 * event-reactions job (events/event-reactions.ts), which logs a failure and
 * retries the job, so a transient fault in a recorder is retried rather than
 * lost (a lost settle would later be recorded as a breach by the sweep). A
 * retry is safe: every recorder is idempotent and guarded on the state it
 * read. Unlike the conversation mutations, the recorders are pure DB writes (no
 * realtime/events), so nothing re-enters the bus.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, TicketId } from '@quackback/ids'
import {
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
} from './sla.service'
import { recordTicketResolution } from './ticket-sla.service'
import { reconcilePendingPauses, reconcileSnoozePauses } from './sla.pause-reconcile'

/** When the message was written, falling back to the event's time when the payload lacks it. */
function messageTime(createdAt: string | undefined, eventTimestamp: string): Date {
  const written = createdAt ? new Date(createdAt) : null
  return written && !Number.isNaN(written.getTime()) ? written : new Date(eventTimestamp)
}

export async function recordSlaFromEvent(event: EventData): Promise<void> {
  switch (event.type) {
    case 'message.created': {
      const conversationId = event.data.message.conversationId as ConversationId
      // The message's own time, not the event's: the reaction runs from a
      // queued job that can run late, and the recorders compare this time
      // with the conversation's message rows.
      const at = messageTime(event.data.message.createdAt, event.timestamp)
      // A customer message wakes a snooze, and every settle judges against
      // the pause ledger, so the ledger is brought up to date first.
      await reconcileSnoozePauses(conversationId, at)
      if (event.data.message.senderType === 'agent' && event.actor?.type !== 'service') {
        // Service actors (Quinn, workflow blocks) never satisfy human-response
        // semantics, the same vocabulary the wait-interrupt path uses.
        // Ordered: the first-response clock settles first, then the armed
        // next-response cycle (if any): a first reply never double-settles
        // a cycle that only a LATER customer message could have armed.
        await recordFirstResponse(conversationId, at)
        await recordNextResponse(conversationId, at)
      } else {
        // A visitor message (re-)arms the next-response clock for the fresh
        // customer-message cycle. When the reply to it already exists (the
        // reaction ran late), the re-arm settles the cycle at that reply.
        await rearmNextResponse(conversationId, at)
      }
      break
    }
    case 'conversation.status_changed': {
      const conversationId = event.data.conversation.id as ConversationId
      const at = new Date(event.timestamp)
      await reconcileSnoozePauses(conversationId, at)
      if (event.data.newStatus === 'closed') await recordResolution(conversationId, at)
      break
    }
    case 'ticket.status_changed': {
      // The ticket twin, on the pending axis. The payload's statuses are
      // categories, not raw status names.
      const ticketId = event.data.ticket.id as TicketId
      const at = new Date(event.timestamp)
      await reconcilePendingPauses(ticketId, at)
      if (event.data.newStatus === 'closed') await recordTicketResolution(ticketId, at)
      break
    }
    default:
      break
  }
}
