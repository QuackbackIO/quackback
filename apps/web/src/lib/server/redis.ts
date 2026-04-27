/**
 * Shared Redis (Dragonfly) client.
 *
 * Lazily creates a single ioredis connection reused across the process.
 * BullMQ manages its own connections; this is for application-level caching.
 */

import Redis from 'ioredis'
import { config } from './config'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      lazyConnect: true,
    })
    client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message)
    })
  }
  return client
}

// ============================================================================
// Cache helpers
// ============================================================================

export const CACHE_KEYS = {
  TENANT_SETTINGS: 'settings:tenant',
  INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
  ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
  SLACK_CHANNELS: 'slack:channels',
  // Set of integration types with platform credentials configured.
  // Hot dependency of getTenantSettings (filters OAuth providers); only
  // changes when an admin saves/deletes a platform credential, so a long
  // TTL with explicit invalidation keeps it cheap.
  PLATFORM_INTEGRATION_TYPES: 'platform-cred:configured-types',
  // Per-user principal type/role lookup. Hit on every authenticated
  // SSR render (bootstrap), changes only on signup or role mutation.
  // Short TTL is fine since the data is tiny and we don't strictly need
  // explicit invalidation for the MVP.
  PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}` as const,
} as const

// PRINCIPAL_BY_USER values share the `principal:user:` prefix so we can
// scan-and-delete with a single SCAN call when bulk role changes happen
// (e.g. a tenant-wide migration). Not used yet; kept as a hook for future
// invalidation needs.
export const PRINCIPAL_KEY_PREFIX = 'principal:user:'

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.warn(`[Cache] GET ${key} failed:`, (err as Error).message)
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch (err) {
    console.warn(`[Cache] SET ${key} failed:`, (err as Error).message)
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    await getRedis().del(...keys)
  } catch (err) {
    console.warn(`[Cache] DEL ${keys.join(', ')} failed:`, (err as Error).message)
  }
}
