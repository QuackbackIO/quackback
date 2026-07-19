/**
 * SLA breach clocks, driven off the event bus (support platform §4.6). The lazy
 * breach evaluator reacts to two event types, with different actor gating per
 * branch:
 *
 *   - message.created settles response clocks, but ONLY on a teammate reply
 *     (senderType 'agent'): first response first, then the armed next-response
 *     cycle (if any) — the first reply never double-settles a clock the
 *     customer cycle hasn't armed yet. A VISITOR message does the opposite:
 *     it never settles anything, it (re-)arms the next-response clock for the
 *     fresh customer-message cycle.
 *   - conversation.status_changed drives the other three recorders (pause on
 *     entering 'snoozed', resume on leaving it, settle time-to-close on a
 *     close) with NO actor check at all. This is intentional, not an
 *     oversight: a workflow action closing or snoozing a conversation moves
 *     these clocks exactly the same as a teammate doing it manually would —
 *     the policy's own pauseOnSnooze setting is what governs pause behavior,
 *     not who (or what) changed the status. Gating these on actor would mean
 *     a workflow's auto-close never settled time-to-close, silently leaving
 *     SLA clocks running on conversations that are actually done.
 *   - ticket.status_changed drives the ticket-side TTR clock
 *     (ticket-sla.service.ts): pause on entering the 'pending' CATEGORY,
 *     resume on leaving it, settle on entering 'closed'. The payload's
 *     previousStatus/newStatus are already status categories, not raw status
 *     names, so a pending -> pending lateral move between two distinct
 *     statuses never double-pauses. Same no-actor-check rule as the
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
 * A status_changed straight from the paused state to 'closed' resumes before
 * it resolves, on BOTH axes (snoozed -> closed for conversations, pending ->
 * closed for tickets), so the close settles against the pause-shifted deadline
 * rather than the stale pre-pause one.
 *
 * recordSlaFromEvent is safe to call fire-and-forget: it swallows every error, so
 * a breach-recording fault never touches the event pipeline. Unlike the
 * conversation mutations, the recorders are pure DB writes (no realtime/events),
 * so nothing re-enters the bus.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, TicketId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
  type SlaApplied,
} from './sla.service'
import {
  recordTicketResolution,
  pauseTicketSlaOnPending,
  resumeTicketSlaFromPending,
  type TicketSlaApplied,
} from './ticket-sla.service'

const log = logger.child({ component: 'sla-event-hooks' })

export async function recordSlaFromEvent(event: EventData): Promise<void> {
  try {
    switch (event.type) {
      case 'message.created': {
        const conversationId = event.data.message.conversationId as ConversationId
        const at = new Date(event.timestamp)
        if (event.data.message.senderType === 'agent') {
          // Ordered: the first-response clock settles first, then the armed
          // next-response cycle (if any) — a first reply never double-settles
          // a cycle that only a LATER customer message could have armed.
          await recordFirstResponse(conversationId, at)
          await recordNextResponse(conversationId, at)
        } else {
          // A visitor message (re-)arms the next-response clock for the fresh
          // customer-message cycle; it never settles anything itself.
          await rearmNextResponse(conversationId, at)
        }
        break
      }
      case 'conversation.status_changed': {
        const conversationId = event.data.conversation.id as ConversationId
        const at = new Date(event.timestamp)
        const { previousStatus, newStatus } = event.data
        // Resolve the snooze transition first so a direct snoozed -> closed
        // move settles against the already-shifted deadline, not the stale
        // one. When it actually wrote a resume, its return value is threaded
        // into recordResolution below so that case doesn't pay for two
        // loadSlaApplied SELECTs of the same row.
        let resumed: SlaApplied | null = null
        if (previousStatus === 'snoozed' && newStatus !== 'snoozed') {
          resumed = await resumeSlaFromSnooze(conversationId, at)
        } else if (newStatus === 'snoozed' && previousStatus !== 'snoozed') {
          await pauseSlaOnSnooze(conversationId, at)
        }
        if (newStatus === 'closed') {
          await recordResolution(conversationId, at, resumed)
        }
        break
      }
      case 'ticket.status_changed': {
        const ticketId = event.data.ticket.id as TicketId
        const at = new Date(event.timestamp)
        const { previousStatus, newStatus } = event.data
        // The ticket twin of the conversation case above, on the pending
        // axis: resolve the pause transition first so a direct pending ->
        // closed move settles against the already-shifted deadline, and
        // thread the resume's fresh stamp into recordTicketResolution to
        // save the second SELECT. Categories, not raw status names — a
        // pending -> pending move between two statuses hits neither branch.
        let resumed: TicketSlaApplied | null = null
        if (previousStatus === 'pending' && newStatus !== 'pending') {
          resumed = await resumeTicketSlaFromPending(ticketId, at)
        } else if (newStatus === 'pending' && previousStatus !== 'pending') {
          await pauseTicketSlaOnPending(ticketId, at)
        }
        if (newStatus === 'closed') {
          await recordTicketResolution(ticketId, at, resumed)
        }
        break
      }
      default:
        break
    }
  } catch (err) {
    log.error({ err, eventType: event.type }, 'SLA event recording failed')
  }
}
