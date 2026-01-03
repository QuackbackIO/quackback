/**
 * Shared integration processing logic.
 *
 * This module contains the business logic for processing integration events.
 */

import { db, integrations, integrationEventMappings, decryptToken, eq } from '@/lib/db'
import {
  integrationRegistry,
  type IntegrationContext,
  type DomainEvent,
} from '@quackback/integrations'
import type { IntegrationData, IntegrationResult } from './types'
import type { IntegrationId, EventMappingId } from '@quackback/ids'

/**
 * Get the single workspace ID (for use as encryption salt).
 * In single-tenant mode, there's only one settings row.
 */
async function getWorkspaceId(): Promise<string> {
  const setting = await db.query.settings.findFirst({
    columns: { id: true },
  })
  if (!setting) {
    throw new Error('Settings not found - workspace not initialized')
  }
  return setting.id
}

/**
 * Load integration configuration from the database.
 */
export async function loadIntegrationConfig(
  integrationId: IntegrationId,
  mappingId: EventMappingId
) {
  const [integration] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1)

  const [mapping] = await db
    .select()
    .from(integrationEventMappings)
    .where(eq(integrationEventMappings.id, mappingId))
    .limit(1)

  return { integration, mapping }
}

/**
 * Process an integration event.
 *
 * @param data - The integration event data
 */
export async function processIntegration(data: IntegrationData): Promise<IntegrationResult> {
  const startTime = Date.now()
  const { integrationId, integrationType, mappingId, event } = data

  try {
    // Load integration config from database
    const { integration, mapping } = await loadIntegrationConfig(integrationId, mappingId)

    if (!integration || !mapping) {
      console.error(`[Integration] Integration or mapping not found: ${integrationId}/${mappingId}`)
      return {
        success: false,
        error: 'Integration or mapping not found',
        durationMs: Date.now() - startTime,
      }
    }

    if (integration.status !== 'active') {
      console.log(`[Integration] Integration ${integrationId} is ${integration.status}, skipping`)
      return {
        success: false,
        error: `Integration is ${integration.status}`,
        durationMs: Date.now() - startTime,
      }
    }

    // Get the integration handler
    const handler = integrationRegistry.get(integrationType)
    if (!handler) {
      console.error(`[Integration] Unknown integration type: ${integrationType}`)
      return {
        success: false,
        error: `Unknown integration: ${integrationType}`,
        durationMs: Date.now() - startTime,
      }
    }

    // Decrypt access token (using workspace ID as salt)
    if (!integration.accessTokenEncrypted) {
      return {
        success: false,
        error: 'No access token configured',
        durationMs: Date.now() - startTime,
      }
    }

    const workspaceId = await getWorkspaceId()
    const accessToken = decryptToken(integration.accessTokenEncrypted, workspaceId)

    // Build context (without Redis - using state adapter instead)
    const ctx: IntegrationContext = {
      integrationId,
      accessToken,
      config: (integration.config as Record<string, unknown>) || {},
      // Note: Redis is not passed here - workers should use the state adapter
    }

    // Process the event - cast DomainEventPayload to DomainEvent
    const result = await handler.processEvent(
      event as unknown as DomainEvent,
      mapping.actionType,
      (mapping.actionConfig as Record<string, unknown>) || {},
      ctx
    )

    if (result.success) {
      console.log(`[Integration] Successfully processed ${event.type} for ${integrationType}`)
    } else {
      console.error(
        `[Integration] Failed to process ${event.type} for ${integrationType}: ${result.error}`
      )

      if (result.shouldRetry) {
        throw new Error(result.error)
      }
    }

    return {
      success: result.success,
      externalEntityId: result.externalEntityId,
      error: result.error,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    console.error(`[Integration] Error processing integration:`, error)
    throw error
  }
}
