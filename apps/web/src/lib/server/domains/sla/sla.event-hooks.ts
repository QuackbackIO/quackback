/**
 * SLA breach clocks, driven off the event bus (support platform §4.6). The lazy
 * breach evaluator reacts to two event types, with different actor gating per
 * branch:
 *
 *   - message.created settles the first-response clock, but ONLY on a
 *     teammate reply (senderType 'agent') — a visitor message never touches
 *     the clock it's waiting on.
 *   - conversation.status_changed drives the other three recorders (pause on
 *     entering 'snoozed', resume on leaving it, settle time-to-close on a
 *     close) with NO actor check at all. This is intentional, not an
 *     oversight: a workflow action closing or snoozing a conversation moves
 *     these clocks exactly the same as a teammate doing it manually would —
 *     the policy's own pauseOnSnooze setting is what governs pause behavior,
 *     not who (or what) changed the status. Gating these on actor would mean
 *     a workflow's auto-close never settled time-to-close, silently leaving
 *     SLA clocks running on conversations that are actually done.
 *
 * All four recorders are idempotent and no-op without an applied SLA, so this
 * can react to every matching event unconditionally. Deadlines that pass with
 * NO further event are caught by the per-minute sweep in
 * sla-breach-sweep-queue.ts; both paths share the breach-noted markers on the
 * stamp so each breach is logged exactly once.
 *
 * A conversation.status_changed straight from 'snoozed' to 'closed' resumes
 * before it resolves, so the close settles against the pause-shifted deadline
 * rather than the stale pre-snooze one.
 *
 * recordSlaFromEvent is safe to call fire-and-forget: it swallows every error, so
 * a breach-recording fault never touches the event pipeline. Unlike the
 * conversation mutations, the recorders are pure DB writes (no realtime/events),
 * so nothing re-enters the bus.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  recordFirstResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
  type SlaApplied,
} from './sla.service'

const log = logger.child({ component: 'sla-event-hooks' })

export async function recordSlaFromEvent(event: EventData): Promise<void> {
  try {
    switch (event.type) {
      case 'message.created':
        // Only a teammate reply settles first response; a visitor message doesn't.
        if (event.data.message.senderType === 'agent') {
          await recordFirstResponse(
            event.data.message.conversationId as ConversationId,
            new Date(event.timestamp)
          )
        }
        break
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
      default:
        break
    }
  } catch (err) {
    log.error({ err, eventType: event.type }, 'SLA event recording failed')
  }
}
