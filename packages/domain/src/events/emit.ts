/**
 * Event emission utilities for domain services.
 */
import { randomUUID } from 'crypto'
import type { ServiceContext } from '../shared/service-context'
import type { DomainEvent, DomainEventType } from './types'
import { dispatchToIntegrations } from './dispatcher'
import { dispatchToUserNotifications } from './user-notification-dispatcher'

/**
 * Emits a domain event for integration processing.
 * This is fire-and-forget - it does not block the caller.
 *
 * @param type - The event type (e.g., 'post.created')
 * @param data - Event-specific payload
 * @param ctx - Service context with organization and user info
 */
export function emitEvent<T>(type: DomainEventType, data: T, ctx: ServiceContext): void {
  const event: DomainEvent<T> = {
    id: randomUUID(),
    type,
    organizationId: ctx.organizationId,
    timestamp: new Date().toISOString(),
    actor: { type: 'user', userId: ctx.userId, email: ctx.userEmail },
    data,
  }

  console.log(`[Events] Emitting ${type} for org ${ctx.organizationId}`)

  // Fire-and-forget: don't block the request
  dispatchToIntegrations(event)
    .then(() => {
      console.log(`[Events] Dispatched ${type} to integrations successfully`)
    })
    .catch((err) => {
      console.error('[Events] Failed to dispatch to integrations:', err)
    })

  // Also dispatch to user notifications (for subscribers)
  dispatchToUserNotifications(event).catch((err) => {
    console.error('[Events] Failed to dispatch to user notifications:', err)
  })
}

/**
 * Emits a domain event from a system process (not user-initiated).
 */
export function emitSystemEvent<T>(
  type: DomainEventType,
  data: T,
  organizationId: string,
  serviceName: string
): void {
  const event: DomainEvent<T> = {
    id: randomUUID(),
    type,
    organizationId,
    timestamp: new Date().toISOString(),
    actor: { type: 'system', service: serviceName },
    data,
  }

  dispatchToIntegrations(event).catch((err) => {
    console.error('[Events] Failed to dispatch system event to integrations:', err)
  })

  // Also dispatch to user notifications (for subscribers)
  dispatchToUserNotifications(event).catch((err) => {
    console.error('[Events] Failed to dispatch system event to user notifications:', err)
  })
}
