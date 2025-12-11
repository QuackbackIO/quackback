/**
 * Idempotency utilities for integration job processing.
 * Prevents duplicate processing when jobs are retried.
 */
import type { Redis } from 'ioredis'

const TTL = 7 * 24 * 60 * 60 // 7 days

/**
 * Checks if an event has already been processed for a specific integration.
 */
export async function isAlreadyProcessed(
  redis: Redis,
  eventId: string,
  integrationId: string
): Promise<boolean> {
  const key = `idem:${eventId}:${integrationId}`
  const exists = await redis.exists(key)
  return exists === 1
}

/**
 * Marks an event as processed for a specific integration.
 * Optionally stores the external entity ID for reference.
 */
export async function markAsProcessed(
  redis: Redis,
  eventId: string,
  integrationId: string,
  externalId?: string
): Promise<void> {
  const key = `idem:${eventId}:${integrationId}`
  await redis.setex(key, TTL, externalId || 'processed')
}

/**
 * Gets the external entity ID if this event was already processed.
 * Returns null if not processed or no external ID was stored.
 */
export async function getProcessedResult(
  redis: Redis,
  eventId: string,
  integrationId: string
): Promise<string | null> {
  const key = `idem:${eventId}:${integrationId}`
  const result = await redis.get(key)
  return result === 'processed' ? null : result
}
