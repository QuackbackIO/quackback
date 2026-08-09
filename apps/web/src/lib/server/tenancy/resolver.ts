/**
 * Host header → verified tenant scope, with the in-process caches that keep it
 * off the request critical path.
 *
 * Two caches, deliberately separate:
 *
 * - **The registry cache** is keyed by hostname with a short TTL. A control-DB
 *   round trip per request would put the control plane on every page render.
 *   `revision` is bumped by a database trigger on any change — including a
 *   hand-run `UPDATE` during an incident — so it is a safe invalidation key, and
 *   the pool cache rebuilds on a revision change even inside the TTL window.
 * - **The pool cache** is keyed by tenant id and holds the sockets. Its lifetime
 *   is governed by idle eviction, not by the registry TTL, because eviction is
 *   the cost model (see `pool-cache.ts`).
 *
 * Negative results are cached too, and for the same reason: an unknown host is
 * exactly what a scanner sends, and an uncached miss makes the control database
 * the target.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { acquireTenantPool } from './pool-cache'
import {
  normalizeHostHeader,
  resolveTenantById,
  resolveTenantByHostname,
  type TenantDescriptor,
  type TenantLookup,
} from './registry'
import type { TenantScope, TenantScopeOrigin } from './tenant-context'

const log = logger.child({ component: 'tenant-resolver' })

interface CacheEntry {
  lookup: TenantLookup
  expiresAt: number
}

const byHostname = new Map<string, CacheEntry>()
const byTenantId = new Map<string, CacheEntry>()

/**
 * A miss is cached for a shorter window than a hit. A newly provisioned tenant
 * should start serving promptly; a scan for `wp-admin.example.com` should not
 * reach Postgres twice.
 */
function missTtlMs(): number {
  return Math.min(config.tenantRegistryTtlMs, 5_000)
}

export function invalidateTenantCache(hostnameOrTenantId?: string): void {
  if (!hostnameOrTenantId) {
    byHostname.clear()
    byTenantId.clear()
    return
  }
  byHostname.delete(hostnameOrTenantId)
  byTenantId.delete(hostnameOrTenantId)
}

/** Resolve a Host header to a registry lookup, cached. */
export async function lookupTenantByHost(hostHeader: string | null): Promise<TenantLookup> {
  const hostname = normalizeHostHeader(hostHeader)
  if (hostname === null) return { kind: 'unknown_host', hostname: String(hostHeader ?? '') }

  const now = Date.now()
  const hit = byHostname.get(hostname)
  if (hit && hit.expiresAt > now) return hit.lookup

  const lookup = await resolveTenantByHostname(hostname)
  const ttl = lookup.kind === 'ok' ? config.tenantRegistryTtlMs : missTtlMs()
  byHostname.set(hostname, { lookup, expiresAt: now + ttl })
  if (lookup.kind === 'ok') {
    byTenantId.set(lookup.tenant.tenantId, { lookup, expiresAt: now + ttl })
  }
  return lookup
}

/** Resolve a tenant id to a registry lookup, cached. For background subsystems. */
export async function lookupTenantById(tenantId: string): Promise<TenantLookup> {
  const now = Date.now()
  const hit = byTenantId.get(tenantId)
  if (hit && hit.expiresAt > now) return hit.lookup

  const lookup = await resolveTenantById(tenantId)
  const ttl = lookup.kind === 'ok' ? config.tenantRegistryTtlMs : missTtlMs()
  byTenantId.set(tenantId, { lookup, expiresAt: now + ttl })
  return lookup
}

/**
 * Everything between a hostname and a servable tenant, in one place.
 *
 * The order is the order in `SAAS-HOSTING-STACK.md` §6, and each step can only
 * narrow: registry (is this host claimed, and is the tenant active?) → pool
 * (build or reuse) → fingerprint (is this database really that tenant's?). Only
 * the last variant carries a database handle, so there is no code path from a
 * suspended or unknown host to a connection.
 */
export type TenantAcquisition =
  | { kind: 'ok'; scope: TenantScope }
  | Exclude<TenantLookup, { kind: 'ok' }>
  | { kind: 'refused'; tenantId: string; code: string; detail: string }

export async function acquireTenantScope(
  tenant: TenantDescriptor,
  origin: TenantScopeOrigin
): Promise<TenantAcquisition> {
  try {
    const pool = await acquireTenantPool(tenant)
    return {
      kind: 'ok',
      scope: { tenant, db: pool.db, sql: pool.sql, secrets: pool.secrets, origin },
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'pool_unavailable'
    const detail = err instanceof Error ? err.message : String(err)
    log.error({ tenantId: tenant.tenantId, code, err }, 'refusing to serve tenant')
    return { kind: 'refused', tenantId: tenant.tenantId, code, detail }
  }
}

/** Host header → scope, in one call. The request path's entry point. */
export async function acquireScopeForHost(
  hostHeader: string | null,
  origin: TenantScopeOrigin = 'request'
): Promise<TenantAcquisition> {
  const lookup = await lookupTenantByHost(hostHeader)
  if (lookup.kind !== 'ok') return lookup
  return acquireTenantScope(lookup.tenant, origin)
}

/** Tenant id → scope. The background path's entry point. */
export async function acquireScopeForTenantId(
  tenantId: string,
  origin: TenantScopeOrigin
): Promise<TenantAcquisition> {
  const lookup = await lookupTenantById(tenantId)
  if (lookup.kind !== 'ok') return lookup
  return acquireTenantScope(lookup.tenant, origin)
}
