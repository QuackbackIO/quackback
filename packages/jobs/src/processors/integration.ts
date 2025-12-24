/**
 * Shared integration processing logic.
 *
 * This module contains the business logic for processing integration events,
 * extracted to be used by both BullMQ workers and Cloudflare Workflows.
 */

import { db, integrations, integrationEventMappings, decryptToken, eq } from '@quackback/db'
import {
  integrationRegistry,
  type IntegrationContext,
  type DomainEvent,
} from '@quackback/integrations'
import type { IntegrationJobData, IntegrationJobResult } from '../types'
import type { StateAdapter } from '../adapters'
import type { WorkspaceId, IntegrationId, EventMappingId } from '@quackback/ids'

/**
 * Load integration configuration from the database.
 */
export async function loadIntegrationConfig(
  _workspaceId: WorkspaceId,
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
 * Process an integration job.
 *
 * @param data - The integration job data
 * @param stateAdapter - State adapter for circuit breaker and idempotency
 */
export async function processIntegration(
  data: IntegrationJobData,
  stateAdapter: StateAdapter
): Promise<IntegrationJobResult> {
  const startTime = Date.now()
  const { workspaceId, integrationId, integrationType, mappingId, event } = data

  // Idempotency check - prevent duplicate processing on retries
  if (await stateAdapter.isProcessed(event.id, integrationId)) {
    console.log(`[Integration] Skipping already processed event ${event.id} for ${integrationId}`)
    return { success: true, durationMs: Date.now() - startTime }
  }

  // Circuit breaker check - prevent hammering failed services
  if (!(await stateAdapter.canExecute(integrationId))) {
    console.log(`[Integration] Circuit open for ${integrationId}, will retry later`)
    throw new Error('Circuit breaker open - will retry')
  }

  try {
    // Load integration config from database
    const { integration, mapping } = await loadIntegrationConfig(
      workspaceId,
      integrationId,
      mappingId
    )

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

    // Decrypt access token
    if (!integration.accessTokenEncrypted) {
      return {
        success: false,
        error: 'No access token configured',
        durationMs: Date.now() - startTime,
      }
    }

    const accessToken = decryptToken(integration.accessTokenEncrypted, workspaceId)

    // Build context (without Redis - using state adapter instead)
    const ctx: IntegrationContext = {
      workspaceId,
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
      await stateAdapter.recordSuccess(integrationId)
      await stateAdapter.markProcessed(event.id, integrationId, result.externalEntityId)
      console.log(`[Integration] Successfully processed ${event.type} for ${integrationType}`)
    } else {
      await stateAdapter.recordFailure(integrationId)
      console.error(
        `[Integration] Failed to process ${event.type} for ${integrationType}: ${result.error}`
      )

      if (result.shouldRetry) {
        throw new Error(result.error) // Will trigger retry
      }
    }

    return {
      success: result.success,
      externalEntityId: result.externalEntityId,
      error: result.error,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    await stateAdapter.recordFailure(integrationId)
    console.error(`[Integration] Error processing job:`, error)
    throw error // Will trigger retry
  }
}
