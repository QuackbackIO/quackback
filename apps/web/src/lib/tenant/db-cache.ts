/**
 * Tenant Database Connection Cache
 *
 * LRU cache for Drizzle database instances per tenant.
 * Reuses connections across requests for the same tenant.
 */
import { createDb, type Database } from '@quackback/db/client'

interface CacheEntry {
  db: Database
  connectionString: string
  lastAccessed: number
}

// LRU cache for Drizzle instances
// Max 100 cached connections, evict after 5 min idle
const cache = new Map<string, CacheEntry>()
const MAX_CONNECTIONS = 100
const TTL_MS = 5 * 60 * 1000

/**
 * Get or create a database connection for a tenant.
 * Connections are cached and reused across requests.
 *
 * If the connection string has changed (e.g., password rotation),
 * the old connection is discarded and a new one is created.
 *
 * @param workspaceId - Unique workspace identifier
 * @param connectionString - Neon database connection string
 * @returns Drizzle database instance
 */
export function getTenantDb(workspaceId: string, connectionString: string): Database {
  const cached = cache.get(workspaceId)

  // Check if cached and connection string hasn't changed
  if (cached && cached.connectionString === connectionString) {
    cached.lastAccessed = Date.now()
    return cached.db
  }

  // Connection string changed - remove stale entry
  if (cached) {
    cache.delete(workspaceId)
  }

  // Create new connection
  // prepare: false for PgBouncer/Neon connection pooler compatibility
  const db = createDb(connectionString, { max: 5, prepare: false })

  // Evict old entries if at capacity
  if (cache.size >= MAX_CONNECTIONS) {
    evictOldest()
  }

  cache.set(workspaceId, { db, connectionString, lastAccessed: Date.now() })
  return db
}

/**
 * Evict stale and oldest entries from the cache.
 */
function evictOldest(): void {
  const now = Date.now()

  // First, remove all stale entries (idle > TTL)
  for (const [key, value] of cache) {
    if (now - value.lastAccessed > TTL_MS) {
      cache.delete(key)
    }
  }

  // If still at capacity, remove the oldest entry
  if (cache.size >= MAX_CONNECTIONS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0]
    if (oldest) {
      cache.delete(oldest[0])
    }
  }
}

/**
 * Clear a specific tenant's cached connection.
 * Use when a tenant's connection string changes.
 */
export function clearTenantDb(workspaceId: string): void {
  cache.delete(workspaceId)
}

/**
 * Clear all cached connections.
 * Use for shutdown or full cache invalidation.
 */
export function clearAllTenantDbs(): void {
  cache.clear()
}
