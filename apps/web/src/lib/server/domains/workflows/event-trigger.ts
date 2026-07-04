/**
 * Event bus -> workflow trigger bridge (support platform §4.6, Slice 5d-iii). Maps
 * a dispatched conversation/message event to a WorkflowTrigger and hands it to the
 * dispatcher. Non-conversation events (posts, comments, tickets, ...) map to null;
 * ticket-scoped triggers are a later extension. dispatchWorkflowsForEvent is fully
 * error-isolated so it can be fire-and-forget from the event pipeline without ever
 * affecting the existing hook delivery.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { PrincipalType } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import { dispatchWorkflowTrigger, type WorkflowTrigger } from './dispatcher'

const log = logger.child({ component: 'workflow-event-trigger' })

/** Map an event to a workflow trigger, or null when it isn't conversation-scoped.
 *  The event's trigger_type is its event type verbatim, so a workflow subscribes
 *  by the same name the bus dispatches. */
export function eventToWorkflowTrigger(event: EventData): WorkflowTrigger | null {
  // An automated (service) actor is carried through; the dispatcher gates it out.
  const actorType: PrincipalType = event.actor?.type === 'service' ? 'service' : 'user'

  switch (event.type) {
    case 'conversation.created': {
      const c = event.data.conversation
      return {
        triggerType: event.type,
        conversationId: c.id as ConversationId,
        actorType,
        subjectPrincipalId: (c.visitorPrincipalId ?? null) as PrincipalId | null,
        message: null,
      }
    }
    case 'conversation.status_changed':
    case 'conversation.assigned':
    case 'conversation.priority_changed':
    case 'conversation.csat_submitted': {
      return {
        triggerType: event.type,
        conversationId: event.data.conversation.id as ConversationId,
        actorType,
        subjectPrincipalId: null,
        message: null,
      }
    }
    case 'message.created':
    case 'message.note_created': {
      const m = event.data.message
      return {
        triggerType: event.type,
        conversationId: m.conversationId as ConversationId,
        actorType,
        // The customer is the frequency-cap subject; a teammate message has none.
        subjectPrincipalId: (m.senderType === 'visitor'
          ? m.authorPrincipalId
          : null) as PrincipalId | null,
        message: { body: m.content },
      }
    }
    default:
      return null
  }
}

/**
 * Fire workflow triggers for a dispatched event. Safe to call fire-and-forget:
 * it maps + dispatches and swallows every error, so a workflow fault never
 * touches the event pipeline or the request that produced the event.
 */
export async function dispatchWorkflowsForEvent(event: EventData): Promise<void> {
  try {
    const trigger = eventToWorkflowTrigger(event)
    if (trigger) await dispatchWorkflowTrigger(trigger)
  } catch (err) {
    log.error({ err, eventType: event.type }, 'workflow dispatch failed')
  }
}
