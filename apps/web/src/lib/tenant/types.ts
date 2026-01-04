/**
 * Tenant Context Types
 */
import type { Database } from '@quackback/db/client'

/**
 * Tenant context available during request processing.
 * Stored in AsyncLocalStorage and accessible throughout the request lifecycle.
 */
export interface TenantContext {
  /** Unique workspace identifier */
  workspaceId: string
  /** Workspace URL slug */
  slug: string
  /** Drizzle database instance connected to tenant's database */
  db: Database
}
