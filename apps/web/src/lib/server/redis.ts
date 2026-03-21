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
} as const

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
