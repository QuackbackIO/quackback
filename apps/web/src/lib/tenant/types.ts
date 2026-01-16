/**
 * Tenant Context Types
 */
import type { Database } from './db-cache'
import type { settings } from '@quackback/db'
import type { InferSelectModel } from 'drizzle-orm'

/** Settings table row type */
type Settings = InferSelectModel<typeof settings>

/**
 * Tenant info returned by the resolver (before request-scoped data is added).
 */
export interface TenantInfo {
  /** Unique workspace identifier */
  workspaceId: string
  /** Workspace URL slug */
  slug: string
  /** Drizzle database instance connected to tenant's database */
  db: Database
}

/**
 * Tenant context available during request processing.
 * Stored in AsyncLocalStorage and accessible throughout the request lifecycle.
 */
export interface TenantContext {
  /** Unique workspace identifier */
  workspaceId: string
  /** Workspace URL slug */
  slug: string
  /** Drizzle database instance connected to tenant's database (null for self-hosted) */
  db: Database | null
  /** Workspace settings (queried once at request start) */
  settings: Settings | null
  /** Request-scoped cache for deduplicating queries within a single request */
  cache: Map<string, unknown>
}
