/**
 * The active tenant, carried on the request-scoped AsyncLocalStorage store.
 *
 * SAAS-HOSTING-STACK.md §6: tenant resolution happens once, from the Host
 * header, before auth runs — auth is itself full of `db` queries, so a tenant
 * decided "once auth resolves" is decided far too late to route the database.
 *
 * The store already exists. `middleware/request-context.ts` opens a
 * `runWithLogContext` object at the very start of every SSR document, server
 * route and server function, and `functions/auth-request-cache.ts` already
 * demonstrates hanging request-scoped state off it under a symbol key. This is
 * the same mechanism, one field wider.
 *
 * Two properties matter and both are load-bearing:
 *
 * 1. **Synchronous read.** `db.ts`'s Proxy trap is synchronous, so the resolved
 *    Drizzle handle has to already be sitting in the store by the time any call
 *    site touches `db`. Acquisition is async and happens in the middleware;
 *    everything downstream just reads.
 * 2. **Absence is an error, not a default.** Under pooled tenancy there is no
 *    fleet-wide database to fall back to, and a fallback is exactly how §3's
 *    failure mode — serving another tenant's data while every permission check
 *    passes — would come back.
 */
import type { Database } from '@quackback/db/client'
import type { Sql } from 'postgres'
import { getLogContext, runWithLogContext, setLogContext } from '@/lib/server/log-context'
import type { TenantDescriptor } from './registry'

/**
 * `Symbol.for` rather than a module-private symbol: the dev server can evaluate
 * a module twice across the SSR/route graph, and two private symbols would give
 * the middleware and the `db` trap two different slots on the same store.
 */
const TENANT_SCOPE_KEY = Symbol.for('quackback.tenantScope')

/** Why a scope exists. Only for logging and the scope audit; never a policy input. */
export type TenantScopeOrigin =
  | 'request'
  | 'sweep'
  | 'queue'
  | 'relay'
  | 'script'
  | 'migration'
  | 'test'

export interface TenantScope {
  readonly tenant: TenantDescriptor
  /** Drizzle handle bound to this tenant's pool. What `db` resolves to. */
  readonly db: Database
  /** The underlying postgres.js handle, for raw/session-level work. */
  readonly sql: Sql
  readonly origin: TenantScopeOrigin
}

export class TenantScopeMissingError extends Error {
  constructor(detail: string) {
    super(
      `No tenant scope is active. ${detail} ` +
        'Under QUACKBACK_TENANCY=pooled every database access must run inside ' +
        'runWithTenantScope() — a request scope opened by the tenant middleware, ' +
        'or an explicit scope opened by a background subsystem.'
    )
    this.name = 'TenantScopeMissingError'
  }
}

type ScopeCarrier = Record<PropertyKey, unknown>

/** The active tenant scope, or null outside one. */
export function getTenantScope(): TenantScope | null {
  const store = getLogContext() as ScopeCarrier | undefined
  if (!store) return null
  return (store[TENANT_SCOPE_KEY] as TenantScope | undefined) ?? null
}

/** The active tenant scope, or throw. */
export function requireTenantScope(detail = 'A tenant-scoped operation was attempted.'): TenantScope {
  const scope = getTenantScope()
  if (!scope) throw new TenantScopeMissingError(detail)
  return scope
}

/**
 * The Drizzle handle for the active tenant, or null.
 *
 * Deliberately non-throwing and dependency-free: this is what `db.ts`'s Proxy
 * trap calls on every property access, and it must not be able to fail for a
 * single-tenant install that has no tenancy configured at all.
 */
export function getScopedDatabase(): Database | null {
  return getTenantScope()?.db ?? null
}

/** The active tenant record, or null. Safe to call from single-tenant code. */
export function getCurrentTenant(): TenantDescriptor | null {
  return getTenantScope()?.tenant ?? null
}

/**
 * Run `fn` with `scope` as the ambient tenant.
 *
 * Always opens a **nested** AsyncLocalStorage run rather than mutating the
 * enclosing store. Mutate-and-restore looks cheaper and is wrong: `fn` is
 * usually async, so a `finally` fires when the promise is *created*, not when
 * it settles — the scope would vanish before the first query. `ALS.run` is the
 * only thing that scopes an async subtree correctly.
 *
 * The parent's fields (`request_id`, `route`) are copied forward so log
 * correlation survives the nesting. On the background paths there is no parent,
 * so a fresh correlated context is opened — which is how a sweeper gets a
 * request id for free once it is scoped.
 *
 * Nesting a *different* tenant inside an existing scope is refused. It has no
 * legitimate use, and permitting it would mean a helper could quietly re-point
 * the database mid-request.
 */
export function runWithTenantScope<T>(scope: TenantScope, fn: () => T): T {
  const parent = getLogContext() as ScopeCarrier | undefined
  const existing = parent?.[TENANT_SCOPE_KEY] as TenantScope | undefined
  if (existing && existing.tenant.tenantId !== scope.tenant.tenantId) {
    throw new Error(
      `Refusing to re-scope an active context from tenant ${existing.tenant.tenantId} ` +
        `to ${scope.tenant.tenantId}.`
    )
  }

  const child: ScopeCarrier = {
    request_id: (parent?.request_id as string | undefined) ?? crypto.randomUUID(),
    route: (parent?.route as string | undefined) ?? `${scope.origin}:${scope.tenant.tenantId}`,
    ...(parent ?? {}),
    tenant_id: scope.tenant.tenantId,
  }
  child[TENANT_SCOPE_KEY] = scope

  // Stamp the tenant onto the PARENT too, so the enclosing access log — emitted
  // after this scope has closed — still says which tenant it served.
  if (parent) setLogContext({ tenant_id: scope.tenant.tenantId })

  return runWithLogContext(child as never, fn)
}
