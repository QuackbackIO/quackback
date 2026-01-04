/**
 * Inline event dispatching utilities
 *
 * These helpers replace the BullMQ job queue with direct inline calls.
 * Events are dispatched using a fire-and-forget pattern - errors are logged but don't block the request.
 */

import { processEvent } from './event-service'
import type { EventData, EventActor } from './types'
import {
  buildPostCreatedEvent,
  buildPostStatusChangedEvent,
  buildCommentCreatedEvent,
  type PostCreatedInput,
  type PostStatusChangedInput,
  type CommentCreatedInput,
  type CommentPostInput,
} from './event-builder'

/**
 * Fire-and-forget event dispatcher
 *
 * Calls processEvent() without awaiting. Errors are logged but don't block the user request.
 */
export function dispatchEvent(event: EventData): void {
  // Fire and forget - don't await
  processEvent(event).catch((error) => {
    console.error(`[Event] Failed to process ${event.type} event ${event.id}:`, error)
    // TODO: Add error monitoring/alerting here (Sentry, etc.)
  })
}

/**
 * Dispatch a post.created event
 *
 * @param actor - Who triggered the event (user or system)
 * @param post - The created post data
 */
export function dispatchPostCreated(actor: EventActor, post: PostCreatedInput): void {
  const event = buildPostCreatedEvent(actor, post)
  dispatchEvent(event)
}

/**
 * Dispatch a post.status_changed event
 *
 * @param actor - Who triggered the event (user or system)
 * @param post - Reference to the post that was updated
 * @param previousStatus - The status name before the change (e.g., "Open")
 * @param newStatus - The status name after the change (e.g., "In Progress")
 */
export function dispatchPostStatusChanged(
  actor: EventActor,
  post: PostStatusChangedInput,
  previousStatus: string,
  newStatus: string
): void {
  const event = buildPostStatusChangedEvent(actor, post, previousStatus, newStatus)
  dispatchEvent(event)
}

/**
 * Dispatch a comment.created event
 *
 * @param actor - Who triggered the event (user or system)
 * @param comment - The created comment data
 * @param post - Reference to the post the comment was added to
 */
export function dispatchCommentCreated(
  actor: EventActor,
  comment: CommentCreatedInput,
  post: CommentPostInput
): void {
  const event = buildCommentCreatedEvent(actor, comment, post)
  dispatchEvent(event)
}
