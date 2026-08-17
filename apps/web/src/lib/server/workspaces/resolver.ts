/**
 * Host header → verified workspace scope, with the in-process caches that keep it
 * off the request critical path.
 *
 * Two caches, deliberately separate:
 *
 * - **The registry cache** is keyed by hostname with a short TTL. A control-DB
 *   round trip per request would put the control plane on every page render.
 *   `revision` is bumped by a database trigger on any change — including a
 *   hand-run `UPDATE` during an incident — so it is a safe invalidation key, and
 *   the pool cache rebuilds on a revision change even inside the TTL window.
 * - **The pool cache** is keyed by workspace id and holds the sockets. Its lifetime
 *   is governed by idle eviction, not by the registry TTL, because eviction is
 *   the cost model (see `pool-cache.ts`).
 *
 * Negative results are cached too, and for the same reason: an unknown host is
 * exactly what a scanner sends, and an uncached miss makes the control database
 * the target.
 */
import { config } from '@/lib/server/config'
import { SCHEMA_FLOOR_REFUSAL_CODE } from '@/lib/server/fleet/schema-floor'
import { logger } from '@/lib/server/logger'
import { noteWorkspaceActivity, type WorkspaceActivitySource } from './idle'
import { acquireWorkspacePool } from './pool-cache'
import {
  normalizeHostHeader,
  resolveWorkspaceById,
  resolveWorkspaceByHostname,
  type WorkspaceDescriptor,
  type WorkspaceLookup,
} from './registry'
import {
  createWorkspaceScope,
  type WorkspaceScope,
  type WorkspaceScopeOrigin,
} from './workspace-context'

const log = logger.child({ component: 'workspace-resolver' })

interface CacheEntry {
  lookup: WorkspaceLookup
  expiresAt: number
}

const byHostname = new Map<string, CacheEntry>()
const byWorkspaceKey = new Map<string, CacheEntry>()

/**
 * A miss is cached for a shorter window than a hit. A newly provisioned workspace
 * should start serving promptly; a scan for `wp-admin.example.com` should not
 * reach Postgres twice.
 */
function missTtlMs(): number {
  return Math.min(config.workspaceRegistryTtlMs, 5_000)
}

export function invalidateWorkspaceCache(hostnameOrWorkspaceKey?: string): void {
  if (!hostnameOrWorkspaceKey) {
    byHostname.clear()
    byWorkspaceKey.clear()
    return
  }
  byHostname.delete(hostnameOrWorkspaceKey)
  byWorkspaceKey.delete(hostnameOrWorkspaceKey)
}

/** Resolve a Host header to a registry lookup, cached. */
export async function lookupWorkspaceByHost(hostHeader: string | null): Promise<WorkspaceLookup> {
  const hostname = normalizeHostHeader(hostHeader)
  if (hostname === null) return { kind: 'unknown_host', hostname: String(hostHeader ?? '') }

  const now = Date.now()
  const hit = byHostname.get(hostname)
  if (hit && hit.expiresAt > now) return hit.lookup

  const lookup = await resolveWorkspaceByHostname(hostname)
  const ttl = lookup.kind === 'ok' ? config.workspaceRegistryTtlMs : missTtlMs()
  byHostname.set(hostname, { lookup, expiresAt: now + ttl })
  if (lookup.kind === 'ok') {
    byWorkspaceKey.set(lookup.workspace.workspaceKey, { lookup, expiresAt: now + ttl })
  }
  return lookup
}

/** Resolve a workspace id to a registry lookup, cached. For background subsystems. */
export async function lookupWorkspaceById(workspaceKey: string): Promise<WorkspaceLookup> {
  const now = Date.now()
  const hit = byWorkspaceKey.get(workspaceKey)
  if (hit && hit.expiresAt > now) return hit.lookup

  const lookup = await resolveWorkspaceById(workspaceKey)
  const ttl = lookup.kind === 'ok' ? config.workspaceRegistryTtlMs : missTtlMs()
  byWorkspaceKey.set(workspaceKey, { lookup, expiresAt: now + ttl })
  return lookup
}

/**
 * Everything between a hostname and a servable workspace, in one place.
 *
 * The order is the order in `SAAS-HOSTING-STACK.md` §6, and each step can only
 * narrow: registry (is this host claimed, and is the workspace active?) → pool
 * (build or reuse) → fingerprint (is this database really that workspace's?). Only
 * the last variant carries a database handle, so there is no code path from a
 * suspended or unknown host to a connection.
 */
export type WorkspaceAcquisition =
  | { kind: 'ok'; scope: WorkspaceScope }
  | Exclude<WorkspaceLookup, { kind: 'ok' }>
  | { kind: 'refused'; workspaceKey: string; code: string; detail: string }

/**
 * Which scope origins count as "somebody is using this workspace".
 *
 * `queue` is the always-warm job tier itself. Counting its own polling as
 * activity would make every workspace permanently busy, which is exactly the
 * state `idle.ts` exists to end — so the exclusion is the load-bearing part
 * of this map, not the inclusions. `test` is excluded so a suite cannot signal a
 * tier it did not mean to start.
 */
const ACTIVITY_ORIGINS: Partial<Record<WorkspaceScopeOrigin, WorkspaceActivitySource>> = {
  request: 'request',
  sweep: 'sweep',
  script: 'script',
  migration: 'migration',
}

export async function acquireWorkspaceScope(
  workspace: WorkspaceDescriptor,
  origin: WorkspaceScopeOrigin
): Promise<WorkspaceAcquisition> {
  try {
    const pool = await acquireWorkspacePool(workspace)
    // After the pool is built, not before: a scope that was refused is not
    // evidence that this workspace is being used, and telling a detached tier to
    // re-attach to a workspace nothing can serve is how the retry storm gets a
    // second entrance.
    const source = ACTIVITY_ORIGINS[origin]
    if (source) noteWorkspaceActivity(workspace.workspaceKey, source)
    return {
      kind: 'ok',
      scope: createWorkspaceScope({
        workspace,
        db: pool.db,
        sql: pool.sql,
        secrets: pool.secrets,
        origin,
      }),
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'pool_unavailable'
    const detail = err instanceof Error ? err.message : String(err)
    // A workspace below the compatibility floor is the expected state during a
    // rollout, not an incident: it is transient, it is that workspace's alone, and
    // it resolves itself when the migrator reaches it. Logging it at `error`
    // alongside genuine refusals means a routine fleet migration produces one
    // error per request per workspace, which is how an alert channel gets muted.
    const level = code === SCHEMA_FLOOR_REFUSAL_CODE ? 'warn' : 'error'
    log[level]({ workspaceKey: workspace.workspaceKey, code, err }, 'refusing to serve workspace')
    return { kind: 'refused', workspaceKey: workspace.workspaceKey, code, detail }
  }
}

/** Host header → scope, in one call. The request path's entry point. */
export async function acquireScopeForHost(
  hostHeader: string | null,
  origin: WorkspaceScopeOrigin = 'request'
): Promise<WorkspaceAcquisition> {
  const lookup = await lookupWorkspaceByHost(hostHeader)
  if (lookup.kind !== 'ok') return lookup
  return acquireWorkspaceScope(lookup.workspace, origin)
}

/** Workspace id → scope. The background path's entry point. */
export async function acquireScopeForWorkspaceId(
  workspaceKey: string,
  origin: WorkspaceScopeOrigin
): Promise<WorkspaceAcquisition> {
  const lookup = await lookupWorkspaceById(workspaceKey)
  if (lookup.kind !== 'ok') return lookup
  return acquireWorkspaceScope(lookup.workspace, origin)
}
