/**
 * The tenant-keyed connection-pool cache (SAAS-HOSTING-STACK.md §6).
 *
 * One process, many tenants, one Neon database each. This is the LRU that turns
 * a resolved tenant record into a live `postgres.js` pool, and it is where the
 * §3 fingerprint assertion is enforced — once per pool, not once per request.
 *
 * ## Eviction is the cost model, not memory hygiene
 *
 * Neon suspends a compute when **no client is connected**. An open pool holds
 * the database awake, so eviction is the single thing that makes an idle tenant
 * cost storage only (~$0.02/month) instead of running compute indefinitely. The
 * same silence is what lets a Railway `role=web` service sleep, since Railway's
 * rule triggers on ten minutes without an *outbound* packet.
 *
 * So `tenantPoolIdleSeconds` must sit comfortably below **both** Neon's
 * `suspend_timeout_seconds` (300s by default) and Railway's 600s window. Get it
 * wrong and every tenant ever routed to an instance stays awake forever —
 * silently, with no functional signal that the cost model has stopped working.
 * That is why `poolsEvicted` is a first-class counter here rather than a debug
 * log: it is the only observable that distinguishes "working" from "quietly
 * costing money".
 *
 * Measured caveat, and it is not optional: eviction is **necessary but not
 * sufficient**. Under `QUACKBACK_ROLE=all` the outbox relay polls the tenant
 * database once per second forever, so the compute never suspends whatever this
 * cache does. Idle saving requires `QUACKBACK_ROLE=web`.
 *
 * ## Credential rotation
 *
 * The record carries `dbRole` as a field precisely because passwords rotate
 * underneath a live pool. `postgres.js` accepts a *function* for `password` and
 * calls it on every new connection, so rotation is handled by re-resolving
 * rather than by wedging: an existing socket keeps working, and the next one
 * picks up the new password. A pool whose credential is revoked outright fails
 * its next connection, is evicted, and is rebuilt on the following request.
 */
import postgres from 'postgres'
import { createDbFromSql, type Database } from '@quackback/db/client'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { evaluateTenantIdentity, observeTenantIdentity, TenantFingerprintRefusal } from './fingerprint'
import { readNeonRolePassword, invalidateNeonRolePassword } from './neon-credentials'
import type { TenantDescriptor } from './registry'
import { parseSecretRef, redactRef } from './vendor/secret-ref'

const log = logger.child({ component: 'tenant-pool-cache' })

export type EvictionReason = 'idle' | 'lru' | 'revision' | 'refused' | 'shutdown' | 'manual'

interface PoolEntry {
  tenantId: string
  revision: number
  sql: postgres.Sql
  db: Database
  createdAt: number
  lastUsedAt: number
  /** Resolves once the database has proven it is the one the registry named. */
  verification: Promise<void>
}

/** Insertion order is the LRU order; a touch is delete-then-set. */
const pools = new Map<string, PoolEntry>()

let sweeper: ReturnType<typeof setInterval> | null = null

const stats = {
  created: 0,
  evicted: 0,
  evictedByReason: {} as Record<EvictionReason, number>,
  refusals: 0,
  firstCreatedAt: 0,
}

export interface PoolCacheStats {
  live: number
  created: number
  evicted: number
  evictedByReason: Record<string, number>
  refusals: number
  /** The §6 metric: pools evicted per hour since the first pool was created. */
  evictionsPerHour: number
  uptimeSeconds: number
}

export function getPoolCacheStats(): PoolCacheStats {
  const rawUptimeMs = stats.firstCreatedAt ? Date.now() - stats.firstCreatedAt : 0
  // Floor the window at one second. A rate over a sub-millisecond window is
  // either infinity or zero depending on clock granularity, and neither is a
  // number anyone should page on.
  const windowMs = Math.max(1_000, rawUptimeMs)
  return {
    live: pools.size,
    created: stats.created,
    evicted: stats.evicted,
    evictedByReason: { ...stats.evictedByReason },
    refusals: stats.refusals,
    evictionsPerHour: stats.firstCreatedAt ? (stats.evicted * 3_600_000) / windowMs : 0,
    uptimeSeconds: Math.round(rawUptimeMs / 1000),
  }
}

export interface AcquiredPool {
  sql: postgres.Sql
  db: Database
}

/**
 * Get (or build) the pool for a tenant, verified.
 *
 * The fingerprint promise is awaited on **every** acquisition, not only on
 * creation. It resolves instantly for a verified pool, but it means a refusal
 * cannot be raced past by a second concurrent request arriving while the first
 * is still checking.
 */
export async function acquireTenantPool(tenant: TenantDescriptor): Promise<AcquiredPool> {
  let entry = pools.get(tenant.tenantId)

  if (entry && entry.revision !== tenant.revision) {
    // The control plane changed something — a rotated role, a repointed
    // database, a new fingerprint. Rebuild rather than reason about which
    // fields are safe to keep.
    await evict(tenant.tenantId, 'revision')
    entry = undefined
  }

  if (!entry) {
    entry = createEntry(tenant)
    pools.set(tenant.tenantId, entry)
    stats.created += 1
    if (!stats.firstCreatedAt) stats.firstCreatedAt = Date.now()
    ensureSweeper()
    await enforceCap(tenant.tenantId)
  } else {
    // Touch: re-insert to move to the MRU end.
    pools.delete(tenant.tenantId)
    pools.set(tenant.tenantId, entry)
  }

  entry.lastUsedAt = Date.now()

  try {
    await entry.verification
  } catch (err) {
    stats.refusals += 1
    await evict(tenant.tenantId, 'refused')
    throw err
  }

  return { sql: entry.sql, db: entry.db }
}

function createEntry(tenant: TenantDescriptor): PoolEntry {
  const sql = postgres(tenant.database.pooledUrl, {
    // Small on purpose. One instance holds N tenant pools, and the Neon pooler
    // multiplexes to a much smaller number of backends anyway; 10 per tenant
    // would be N×10 sockets for no throughput.
    max: config.tenantPoolMax,
    // Keep protocol-level prepared statements. Verified safe through the Neon
    // pooler under real backend reassignment; the boundary is that Drizzle emits
    // explicit column lists, so a hand-written `SELECT *` in a migration-adjacent
    // path would break it.
    prepare: true,
    // Below Neon's suspend timeout AND Railway's sleep window. This is the
    // number the cost model rests on.
    idle_timeout: config.tenantPoolIdleSeconds,
    connect_timeout: 15,
    password: () => resolvePassword(tenant),
    onnotice: () => {},
  })

  const db = createDbFromSql(sql)

  const entry: PoolEntry = {
    tenantId: tenant.tenantId,
    revision: tenant.revision,
    sql,
    db,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    verification: verify(tenant, sql),
  }
  // A rejected verification promise with no attached handler would surface as an
  // unhandled rejection before the first `await` reaches it.
  entry.verification.catch(() => {})
  return entry
}

async function resolvePassword(tenant: TenantDescriptor): Promise<string> {
  const ref = tenant.database.credentialRef
  const parsed = parseSecretRef(ref)
  switch (parsed.scheme) {
    case 'neon+role':
      return readNeonRolePassword({
        projectId: parsed.projectId,
        branchId: parsed.branchId,
        role: parsed.role,
      })
    case 'env': {
      const value = process.env[parsed.variable]
      if (!value) {
        throw new Error(`${redactRef(ref)} names ${parsed.variable}, which is unset`)
      }
      return value
    }
    case 'openbao+static-role':
      throw new Error(
        `${redactRef(ref)} needs an OpenBao reader; this process has none configured`
      )
    case 'openbao+kv':
      throw new Error('openbao+kv refs hold the app secret bundle, not database credentials')
  }
}

/**
 * The assertion, run once per pool.
 *
 * On refusal the credential memo is dropped too: the commonest cause of a
 * refusal that later resolves itself is a rotation mid-flight, and leaving a
 * stale password memoised would make the retry fail for a second, unrelated
 * reason.
 */
async function verify(tenant: TenantDescriptor, sql: postgres.Sql): Promise<void> {
  // Resolve the credential once, eagerly, before the first connection. Not for
  // caching — `postgres.js` calls the provider per connection either way — but
  // for the error. A password provider that throws is swallowed by the driver
  // and reported as `CONNECT_TIMEOUT` fifteen seconds later, which is both slow
  // and names the wrong cause; a missing secret should say so immediately.
  await resolvePassword(tenant)

  const observed = await observeTenantIdentity(sql)
  const verdict = evaluateTenantIdentity(tenant.fingerprint, tenant.physical, observed)
  if (verdict.ok) {
    log.info(
      {
        tenantId: tenant.tenantId,
        workspaceId: observed.workspaceId,
        stampSource: observed.stampSource,
        neonBranchId: observed.physical.neonBranchId,
      },
      'tenant database fingerprint verified'
    )
    return
  }

  const parsed = parseSecretRef(tenant.database.credentialRef)
  if (parsed.scheme === 'neon+role') invalidateNeonRolePassword(parsed)

  log.error(
    {
      tenantId: tenant.tenantId,
      code: verdict.code,
      detail: verdict.detail,
      observedWorkspaceId: observed.workspaceId,
      observedBranchId: observed.physical.neonBranchId,
      expectedBranchId: tenant.physical.neonBranchId,
    },
    'tenant database fingerprint REFUSED'
  )
  throw new TenantFingerprintRefusal(tenant.tenantId, verdict.code, verdict.detail)
}

async function enforceCap(keepTenantId: string): Promise<void> {
  const cap = config.tenantPoolMaxEntries
  while (pools.size > cap) {
    // Map iteration is insertion order, so the first key is the least recently
    // used. Never evict the tenant we are about to serve.
    let victim: string | null = null
    for (const key of pools.keys()) {
      if (key !== keepTenantId) {
        victim = key
        break
      }
    }
    if (victim === null) return
    await evict(victim, 'lru')
  }
}

/** Close and forget a tenant's pool. Idempotent. */
export async function evict(tenantId: string, reason: EvictionReason): Promise<boolean> {
  const entry = pools.get(tenantId)
  if (!entry) return false
  pools.delete(tenantId)
  stats.evicted += 1
  stats.evictedByReason[reason] = (stats.evictedByReason[reason] ?? 0) + 1
  const ageMs = Date.now() - entry.createdAt
  const idleMs = Date.now() - entry.lastUsedAt
  log.info({ tenantId, reason, age_ms: ageMs, idle_ms: idleMs }, 'tenant pool evicted')
  await entry.sql.end({ timeout: 5 }).catch(() => {})
  return true
}

/**
 * Close pools that have been idle past the threshold.
 *
 * `postgres.js` already closes idle *sockets* after `idle_timeout`, which is
 * what actually lets Neon suspend. This sweep additionally drops the pool
 * object, which is what stops a tenant that was routed here once from holding a
 * slot in the LRU forever, and what makes the eviction counter meaningful.
 */
export async function sweepIdlePools(now = Date.now()): Promise<number> {
  const thresholdMs = config.tenantPoolIdleSeconds * 1000
  const doomed: string[] = []
  for (const [tenantId, entry] of pools) {
    if (now - entry.lastUsedAt >= thresholdMs) doomed.push(tenantId)
  }
  for (const tenantId of doomed) await evict(tenantId, 'idle')
  return doomed.length
}

function ensureSweeper(): void {
  if (sweeper) return
  const periodMs = Math.max(5_000, Math.floor((config.tenantPoolIdleSeconds * 1000) / 3))
  sweeper = setInterval(() => {
    // Open a fresh log context. The first pool is created inside a request, so
    // the interval inherits that request's AsyncLocalStorage store — and every
    // eviction for the life of the process would then be stamped with one
    // long-finished request's id and route. A log line that names a request
    // which did not cause it is worse than one with no request at all.
    void runWithLogContext({ request_id: crypto.randomUUID(), route: 'sweep:tenant-pools' }, () =>
      sweepIdlePools().catch((err) => log.warn({ err }, 'idle pool sweep failed'))
    )
  }, periodMs)
  // Never hold the process open. An eviction sweeper that prevented exit would
  // be the same class of bug as a pool that prevents suspend.
  sweeper.unref?.()
}

export async function closeAllTenantPools(): Promise<void> {
  if (sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
  const ids = [...pools.keys()]
  for (const id of ids) await evict(id, 'shutdown')
}

/** Test seam: forget everything, including counters. */
export async function __resetPoolCacheForTests(): Promise<void> {
  await closeAllTenantPools()
  stats.created = 0
  stats.evicted = 0
  stats.evictedByReason = {} as Record<EvictionReason, number>
  stats.refusals = 0
  stats.firstCreatedAt = 0
}
