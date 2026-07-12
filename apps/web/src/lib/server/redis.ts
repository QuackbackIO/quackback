/**
 * Shared Redis (Dragonfly) client.
 *
 * Lazily creates a single ioredis connection reused across the process.
 * BullMQ manages its own connections; this is for application-level caching.
 */

import Redis from 'ioredis'
import { config } from './config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'redis' })

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      lazyConnect: true,
    })
    client.on('error', (err) => {
      log.error({ err }, 'connection error')
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
  // v2 invalidates rows cached before migration 0123 added the
  // conversation.csat_comment_added subscription.
  ACTIVE_WEBHOOKS: 'hooks:webhooks-active:v2',
  SLACK_CHANNELS: 'slack:channels',
  // Hot dependency of getTenantSettings; invalidated by save/delete in
  // platform-credential.service.ts.
  PLATFORM_INTEGRATION_TYPES: 'platform-cred:configured-types',
  // Per-user principal type/role lookup hit on every authenticated SSR
  // render. Invalidated by role/type mutations; 5min TTL backstops anything
  // we miss.
  PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}` as const,
} as const

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    log.warn({ err, key }, 'cache get failed')
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch (err) {
    log.warn({ err, key }, 'cache set failed')
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    await getRedis().del(...keys)
  } catch (err) {
    log.warn({ err, keys }, 'cache del failed')
  }
}
