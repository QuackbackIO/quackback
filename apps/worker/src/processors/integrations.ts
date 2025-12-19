/**
 * Integration job processor.
 * Processes domain events by calling the appropriate integration handler.
 */
import type { Job } from 'bullmq'
import {
  withTenantContext,
  workspaceIntegrations,
  integrationEventMappings,
  integrationSyncLog,
  decryptToken,
  eq,
} from '@quackback/db'
import {
  createRedisClient,
  type IntegrationJobData,
  type IntegrationJobResult,
} from '@quackback/jobs'
import {
  integrationRegistry,
  CircuitBreaker,
  isAlreadyProcessed,
  markAsProcessed,
  type IntegrationContext,
} from '@quackback/integrations'
import type { WorkspaceId } from '@quackback/ids'

// Lazy-initialized Redis client
let _redis: ReturnType<typeof createRedisClient> | null = null

function getRedis() {
  if (!_redis) {
    _redis = createRedisClient()
  }
  return _redis
}

/**
 * Processes an integration job.
 */
export async function processIntegrationJob(
  job: Job<IntegrationJobData>
): Promise<IntegrationJobResult> {
  const startTime = Date.now()
  const { workspaceId, integrationId, integrationType, mappingId, event } = job.data
  const redis = getRedis()

  // Idempotency check - prevent duplicate processing on retries
  if (await isAlreadyProcessed(redis, event.id, integrationId)) {
    console.log(`[Integration] Skipping already processed event ${event.id} for ${integrationId}`)
    return { success: true, durationMs: Date.now() - startTime }
  }

  // Circuit breaker check - prevent hammering failed services
  const circuitBreaker = new CircuitBreaker(integrationId, redis)
  if (!(await circuitBreaker.canExecute())) {
    console.log(`[Integration] Circuit open for ${integrationId}, will retry later`)
    throw new Error('Circuit breaker open - will retry')
  }

  try {
    // Load integration config from database
    const { integration, mapping } = await withTenantContext(workspaceId, async (db) => {
      const [integration] = await db
        .select()
        .from(workspaceIntegrations)
        .where(eq(workspaceIntegrations.id, integrationId))
        .limit(1)

      const [mapping] = await db
        .select()
        .from(integrationEventMappings)
        .where(eq(integrationEventMappings.id, mappingId))
        .limit(1)

      return { integration, mapping }
    })

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

    // Build context
    const ctx: IntegrationContext = {
      workspaceId,
      integrationId,
      accessToken,
      config: (integration.config as Record<string, unknown>) || {},
      redis,
    }

    // Process the event
    const result = await handler.processEvent(
      event,
      mapping.actionType,
      (mapping.actionConfig as Record<string, unknown>) || {},
      ctx
    )

    // Record result in sync log
    await recordSyncLog(
      workspaceId,
      integrationId,
      event.id,
      event.type,
      mapping.actionType,
      result,
      startTime
    )

    if (result.success) {
      await circuitBreaker.recordSuccess()
      await markAsProcessed(redis, event.id, integrationId, result.externalEntityId)
      console.log(`[Integration] Successfully processed ${event.type} for ${integrationType}`)
    } else {
      await circuitBreaker.recordFailure()
      console.error(
        `[Integration] Failed to process ${event.type} for ${integrationType}: ${result.error}`
      )

      if (result.shouldRetry) {
        throw new Error(result.error) // BullMQ will retry
      }
    }

    return {
      success: result.success,
      externalEntityId: result.externalEntityId,
      error: result.error,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    await circuitBreaker.recordFailure()
    console.error(`[Integration] Error processing job:`, error)

    // Record failure in sync log
    await recordSyncLog(
      workspaceId,
      integrationId,
      event.id,
      event.type,
      'unknown',
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      startTime
    )

    throw error // BullMQ will retry
  }
}

/**
 * Records a sync operation in the audit log.
 */
async function recordSyncLog(
  workspaceId: WorkspaceId,
  integrationId: string,
  eventId: string,
  eventType: string,
  actionType: string,
  result: { success: boolean; error?: string },
  startTime: number
): Promise<void> {
  try {
    await withTenantContext(workspaceId, async (db) => {
      await db.insert(integrationSyncLog).values({
        integrationId,
        eventId,
        eventType,
        actionType,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.error,
        durationMs: Date.now() - startTime,
      })
    })
  } catch (err) {
    // Don't fail the job if sync log fails
    console.error('[Integration] Failed to record sync log:', err)
  }
}
