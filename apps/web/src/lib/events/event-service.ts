/**
 * Shared event processing logic.
 *
 * This module consolidates integration and notification processing into a single
 * flow, used for inline event processing.
 */

import { db, integrations, integrationEventMappings, eq } from '@/lib/db'
import type { IntegrationId, EventMappingId } from '@quackback/ids'
import type { EventData, EventResult, IntegrationData, DomainEventPayload } from './types'
import { processIntegration } from './integration-service'
import { processUserNotification } from './notification-service'

/**
 * Integration mapping from database query.
 */
export interface IntegrationMapping {
  integrationId: IntegrationId
  integrationType: string
  mappingId: EventMappingId
  eventType: string
  actionType: string
  actionConfig: unknown
  filters: unknown
  enabled: boolean
  status: string
}

/**
 * Event types that should trigger user notifications.
 */
const NOTIFICATION_EVENT_TYPES = ['post.status_changed', 'comment.created'] as const

/**
 * Check if an event type should trigger user notifications.
 */
export function isNotificationEvent(eventType: string): boolean {
  return NOTIFICATION_EVENT_TYPES.includes(eventType as (typeof NOTIFICATION_EVENT_TYPES)[number])
}

/**
 * Get integration mappings for an event type.
 * This queries the database directly (no caching - caching is done at workflow step level).
 */
export async function getIntegrationMappings(eventType: string): Promise<IntegrationMapping[]> {
  const mappings = await db
    .select({
      integrationId: integrations.id,
      integrationType: integrations.integrationType,
      mappingId: integrationEventMappings.id,
      eventType: integrationEventMappings.eventType,
      actionType: integrationEventMappings.actionType,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
      enabled: integrationEventMappings.enabled,
      status: integrations.status,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))

  // Filter to relevant mappings for this event type
  return mappings.filter(
    (m) => m.eventType === eventType && m.enabled && m.status === 'active'
  ) as IntegrationMapping[]
}

/**
 * Process a single integration for an event.
 * Returns success/error status without throwing.
 */
export async function processSingleIntegration(
  mapping: IntegrationMapping,
  event: EventData
): Promise<{ success: boolean; error?: string }> {
  try {
    const jobData: IntegrationData = {
      integrationId: mapping.integrationId,
      integrationType: mapping.integrationType,
      mappingId: mapping.mappingId,
      event: {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        actor: event.actor,
        data: event.data,
      } as DomainEventPayload,
    }

    const result = await processIntegration(jobData)
    return { success: result.success, error: result.error }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Event] Integration ${mapping.integrationType} failed:`, error)
    return { success: false, error: msg }
  }
}

/**
 * Process user notifications for an event.
 * Returns success/error status without throwing.
 */
export async function processEventNotifications(
  event: EventData
): Promise<{ emailsSent: number; skipped: number; errors: string[] }> {
  if (!isNotificationEvent(event.type)) {
    return { emailsSent: 0, skipped: 0, errors: [] }
  }

  try {
    const result = await processUserNotification({
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      actor: event.actor,
      data: event.data,
    })
    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Event] User notifications failed:`, error)
    return { emailsSent: 0, skipped: 0, errors: [msg] }
  }
}

/**
 * Process a complete event (integrations + notifications).
 * This is the main entry point for event processing in non-workflow contexts.
 */
export async function processEvent(data: EventData): Promise<EventResult> {
  console.log(`[Event] Processing ${data.type} event ${data.id}`)

  const result: EventResult = {
    integrationsProcessed: 0,
    integrationErrors: [],
    notificationsSent: 0,
    notificationErrors: [],
  }

  // Step 1: Get integration mappings
  const mappings = await getIntegrationMappings(data.type)
  console.log(`[Event] Found ${mappings.length} integration mappings for ${data.type}`)

  // Step 2: Process each integration
  for (const mapping of mappings) {
    const integrationResult = await processSingleIntegration(mapping, data)
    if (integrationResult.success) {
      result.integrationsProcessed++
    } else if (integrationResult.error) {
      result.integrationErrors.push(`${mapping.integrationType}: ${integrationResult.error}`)
    }
  }

  // Step 3: Process user notifications
  if (isNotificationEvent(data.type)) {
    const notifResult = await processEventNotifications(data)
    result.notificationsSent = notifResult.emailsSent
    result.notificationErrors = notifResult.errors
  }

  console.log(
    `[Event] Completed: ${result.integrationsProcessed} integrations, ` +
      `${result.notificationsSent} notifications, ` +
      `${result.integrationErrors.length + result.notificationErrors.length} errors`
  )

  return result
}
