/**
 * Dispatches domain events to the user notification queue.
 * Subscribers to posts will receive email notifications for relevant events.
 */
import { addUserNotificationJob } from '@quackback/jobs/queues'
import type { DomainEvent } from './types'

/**
 * Events that should trigger user notifications
 */
const USER_NOTIFICATION_EVENTS = ['post.status_changed', 'comment.created'] as const

type UserNotificationEventType = (typeof USER_NOTIFICATION_EVENTS)[number]

function isUserNotificationEvent(type: string): type is UserNotificationEventType {
  return USER_NOTIFICATION_EVENTS.includes(type as UserNotificationEventType)
}

/**
 * Dispatches a domain event to the user notification queue if applicable.
 * Only certain events (status changes, new comments) trigger user notifications.
 *
 * @param event - The domain event to dispatch
 */
export async function dispatchToUserNotifications(event: DomainEvent): Promise<void> {
  // Only process events that should trigger user notifications
  if (!isUserNotificationEvent(event.type)) {
    return
  }

  console.log(`[UserNotifications] Dispatching ${event.type} for org ${event.organizationId}`)

  try {
    const jobId = await addUserNotificationJob({
      eventId: event.id,
      eventType: event.type,
      organizationId: event.organizationId,
      timestamp: event.timestamp,
      actor: event.actor,
      data: event.data,
    })

    console.log(`[UserNotifications] Job ${jobId} enqueued for event ${event.id}`)
  } catch (error) {
    console.error(`[UserNotifications] Failed to enqueue job for event ${event.id}:`, error)
    throw error
  }
}
