/**
 * Integration event dispatcher.
 * Queries integration mappings and enqueues jobs for matching integrations.
 */
import { createRedisClient, addIntegrationJob } from '@quackback/jobs'
import { db, organizationIntegrations, integrationEventMappings, eq } from '@quackback/db'
import type { OrgId } from '@quackback/ids'
import type { DomainEvent } from './types'

const CACHE_TTL = 300 // 5 minutes

// Lazy-initialized Redis client
let _redis: ReturnType<typeof createRedisClient> | null = null

function getRedis() {
  if (!_redis) {
    _redis = createRedisClient()
  }
  return _redis
}

interface CachedMapping {
  integrationId: string
  integrationType: string
  mappingId: string
  eventType: string
  actionType: string
  actionConfig: unknown
  filters: unknown
  enabled: boolean
  status: string
}

/**
 * Dispatches a domain event to all relevant integrations.
 * Queries integration mappings (cached) and enqueues jobs for each match.
 */
export async function dispatchToIntegrations(event: DomainEvent): Promise<void> {
  // Get mappings for this organization (cached)
  const mappings = await getCachedMappings(event.organizationId)
  console.log(
    `[Dispatcher] Found ${mappings.length} total mappings for org ${event.organizationId}`
  )

  // Filter to relevant mappings for this event type
  const relevantMappings = mappings.filter(
    (m) => m.eventType === event.type && m.enabled && m.status === 'active'
  )

  console.log(`[Dispatcher] Found ${relevantMappings.length} relevant mappings for ${event.type}`)

  if (relevantMappings.length === 0) {
    return
  }

  // Enqueue jobs for each matching integration
  await Promise.all(
    relevantMappings.map((mapping) =>
      addIntegrationJob({
        organizationId: event.organizationId,
        integrationId: mapping.integrationId,
        integrationType: mapping.integrationType,
        mappingId: mapping.mappingId,
        event: {
          id: event.id,
          type: event.type,
          organizationId: event.organizationId,
          timestamp: event.timestamp,
          actor: event.actor,
          data: event.data,
        },
      })
    )
  )
}

/**
 * Gets integration mappings for an organization with Redis caching.
 */
async function getCachedMappings(organizationId: OrgId): Promise<CachedMapping[]> {
  const redis = getRedis()
  const cacheKey = `int:mappings:${organizationId}`

  // Check cache first
  const cached = await redis.get(cacheKey)
  if (cached) {
    return JSON.parse(cached)
  }

  // Query database
  const mappings = await db
    .select({
      integrationId: organizationIntegrations.id,
      integrationType: organizationIntegrations.integrationType,
      mappingId: integrationEventMappings.id,
      eventType: integrationEventMappings.eventType,
      actionType: integrationEventMappings.actionType,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
      enabled: integrationEventMappings.enabled,
      status: organizationIntegrations.status,
    })
    .from(integrationEventMappings)
    .innerJoin(
      organizationIntegrations,
      eq(integrationEventMappings.integrationId, organizationIntegrations.id)
    )
    .where(eq(organizationIntegrations.organizationId, organizationId))

  // Cache the results
  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(mappings))

  return mappings
}

/**
 * Invalidates the mapping cache for an organization.
 * Call this when integration config changes.
 */
export async function invalidateMappingCache(organizationId: OrgId): Promise<void> {
  const redis = getRedis()
  await redis.del(`int:mappings:${organizationId}`)
}
