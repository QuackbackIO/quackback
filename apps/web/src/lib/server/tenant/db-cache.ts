/**
 * Tenant Database Connection Cache
 *
 * LRU cache for Drizzle database instances per tenant.
 * Reuses connections across requests for the same tenant.
 *
 * Uses @neondatabase/serverless for Cloudflare Workers compatibility.
 */
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '@quackback/db/schema'
import { decryptConnectionString } from '@/lib/server/domains/catalog'

export type Database = ReturnType<typeof drizzle<typeof schema>>

interface CacheEntry {
  db: Database
  encryptedConnectionString: string
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
 * Accepts the ENCRYPTED connection string to avoid expensive scrypt
 * key derivation on cache hits. Decryption only happens on cache miss.
 *
 * If the connection string has changed (e.g., password rotation),
 * the old connection is discarded and a new one is created.
 *
 * @param workspaceId - Unique workspace identifier
 * @param encryptedConnectionString - Encrypted Neon database connection string
 * @returns Drizzle database instance
 */
export async function getTenantDb(
  workspaceId: string,
  encryptedConnectionString: string
): Promise<Database> {
  const cached = cache.get(workspaceId)

  // Check if cached and encrypted connection string hasn't changed
  if (cached && cached.encryptedConnectionString === encryptedConnectionString) {
    cached.lastAccessed = Date.now()
    return cached.db
  }

  // Connection string changed - remove stale entry
  if (cached) {
    cache.delete(workspaceId)
  }

  // Decrypt the connection string (expensive scrypt operation - only on cache miss)
  const connectionString = await decryptConnectionString(encryptedConnectionString, workspaceId)

  // Create new connection using Neon HTTP driver (for Cloudflare Workers)
  const sql = neon(connectionString)
  const db = drizzle(sql, { schema })

  // Evict old entries if at capacity
  if (cache.size >= MAX_CONNECTIONS) {
    evictOldest()
  }

  cache.set(workspaceId, { db, encryptedConnectionString, lastAccessed: Date.now() })
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
