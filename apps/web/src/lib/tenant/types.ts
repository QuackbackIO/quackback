/**
 * Tenant Context Types
 */
import type { Database } from './db-cache'
import type { settings } from '@quackback/db'
import type { InferSelectModel } from 'drizzle-orm'

/** Settings table row type */
export type Settings = InferSelectModel<typeof settings>

/**
 * Request context types - discriminated union for different request scenarios.
 * Replaces magic strings like 'unknown', 'self-hosted', '' for workspaceId.
 */
export type RequestContextType = 'app-domain' | 'self-hosted' | 'tenant' | 'unknown'

/** App domain request (e.g., app.quackback.io) - no tenant context needed */
export interface AppDomainContext {
  type: 'app-domain'
}

/** Self-hosted mode - single workspace using DATABASE_URL */
export interface SelfHostedContext {
  type: 'self-hosted'
  settings: Settings | null
}

/** Multi-tenant mode with resolved tenant */
export interface TenantResolvedContext {
  type: 'tenant'
  workspaceId: string
  settings: Settings | null
}

/** Multi-tenant mode with no resolved tenant for domain */
export interface UnknownDomainContext {
  type: 'unknown'
}

/** Discriminated union of all request context types */
export type RequestContext =
  | AppDomainContext
  | SelfHostedContext
  | TenantResolvedContext
  | UnknownDomainContext

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
 * Internal tenant context stored in AsyncLocalStorage.
 * Use RequestContext for route-level context discrimination.
 */
export interface TenantContext {
  /** Context type for discriminated handling */
  contextType: RequestContextType
  /** Workspace URL slug */
  slug: string
  /** Drizzle database instance connected to tenant's database (null for self-hosted or app domain) */
  db: Database | null
  /** Workspace settings (queried once at request start) */
  settings: Settings | null
  /** Request-scoped cache for deduplicating queries within a single request */
  cache: Map<string, unknown>
  /** Workspace ID (only present for tenant context type) */
  workspaceId?: string
}
