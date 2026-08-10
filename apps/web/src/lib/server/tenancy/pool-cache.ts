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
import { assertSchemaFloor } from '@/lib/server/fleet/schema-floor'
import {
  evaluateSecretKeyCanary,
  evaluateTenantIdentity,
  observeTenantIdentity,
  TenantFingerprintRefusal,
} from './fingerprint'
import { readNeonRolePassword, invalidateNeonRolePassword } from './neon-credentials'
import type { TenantDescriptor } from './registry'
import { clearTenantSecretsCache, resolveTenantSecrets } from './tenant-secrets'
import { parseSecretRef, redactRef } from './vendor/secret-ref'
import type { ResolvedTenantSecrets } from './vendor/tenant-secret-resolution'

const log = logger.child({ component: 'tenant-pool-cache' })

export type EvictionReason = 'idle' | 'lru' | 'revision' | 'refused' | 'shutdown' | 'manual'

interface PoolEntry {
  tenantId: string
  revision: number
  sql: postgres.Sql
  db: Database
  createdAt: number
  lastUsedAt: number
  /**
   * Resolves once the database has proven it is the one the registry named AND
   * this process has proven it holds that tenant's own `SECRET_KEY`. It yields
   * the resolved secret bundle, so "verified" and "has credentials" are one
   * state rather than two that can disagree.
   */
  verification: Promise<ResolvedTenantSecrets>
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
  /** Resolved on this same checkout — see `tenant-secrets.ts`. */
  secrets: ResolvedTenantSecrets
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

  let secrets: ResolvedTenantSecrets
  try {
    secrets = await entry.verification
  } catch (err) {
    stats.refusals += 1
    await evict(tenant.tenantId, 'refused')
    throw err
  }

  return { sql: entry.sql, db: entry.db, secrets }
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
    verification: verifyTenantDatabase(tenant, sql),
  }
  // A rejected verification promise with no attached handler would surface as an
  // unhandled rejection before the first `await` reaches it.
  entry.verification.catch(() => {})
  return entry
}

/**
 * Dereference a tenant's database credential.
 *
 * Exported because the queue tier's `LISTEN` connections terminate at the
 * **direct** endpoint rather than at the pooled one, so they are built outside
 * this cache and still need the same credential — resolved by the same function
 * so a rotation cannot be picked up by one path and missed by the other.
 */
export async function resolveTenantPassword(tenant: TenantDescriptor): Promise<string> {
  return resolvePassword(tenant)
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
      throw new Error(`${redactRef(ref)} needs an OpenBao reader; this process has none configured`)
    case 'openbao+kv':
    case 'derived+hkdf':
    case 'sealed+aead':
      // All three name an APPLICATION secret. A database password is issued by a
      // provider or a vault and is never a value this system chooses, so a
      // derived one would be a plausible-looking string that no server accepts.
      throw new Error(`${parsed.scheme}:// refs hold application secrets, not database credentials`)
  }
}

/**
 * The assertion, run once per pool.
 *
 * On refusal the credential memo is dropped too: the commonest cause of a
 * refusal that later resolves itself is a rotation mid-flight, and leaving a
 * stale password memoised would make the retry fail for a second, unrelated
 * reason.
 *
 * Shared by the request pool cache and by `openTenantDirectPool` below, so the
 * pooled and direct paths cannot disagree about whether a database really is the
 * tenant the registry named. A second copy of a fail-closed identity check is a
 * second copy that can drift open.
 */
async function verifyTenantDatabase(
  tenant: TenantDescriptor,
  sql: postgres.Sql
): Promise<ResolvedTenantSecrets> {
  // Resolve the credential once, eagerly, before the first connection. Not for
  // caching — `postgres.js` calls the provider per connection either way — but
  // for the error. A password provider that throws is swallowed by the driver
  // and reported as `CONNECT_TIMEOUT` fifteen seconds later, which is both slow
  // and names the wrong cause; a missing secret should say so immediately.
  await resolvePassword(tenant)

  // Before the first query, and before the fingerprint. An unresolvable
  // `SECRET_KEY` is not a degraded tenant, it is a tenant this process must not
  // touch — every write path downstream would encrypt under the fleet-wide key.
  // Resolving it here is also what makes it atomic with the DSN: both come off
  // the one descriptor this function was handed.
  const secrets = await resolveTenantSecrets(tenant)

  // The resolved key goes in with the read: the identity question includes
  // whether this key opens ciphertext the database is already holding, and that
  // has to be answered from a sample rather than from the minted canary alone.
  const observed = await observeTenantIdentity(sql, secrets.secretKey)
  const verdict = evaluateTenantIdentity(tenant.fingerprint, tenant.physical, observed)
  const keyVerdict = verdict.ok
    ? evaluateSecretKeyCanary(
        tenant.tenantId,
        secrets.secretKey,
        observed.secretCanary,
        observed.storedCiphertext
      )
    : verdict
  if (keyVerdict.ok) {
    // §10.5's compatibility gate, in the same pass and cached the same way: this
    // database is the right one, but is its schema new enough for this build to
    // read? Deliberately *after* the identity checks — asking a database we have
    // not established the identity of what version it is at would be answering
    // the second question before the first.
    await assertSchemaFloor(tenant.tenantId, sql)
    log.info(
      {
        tenantId: tenant.tenantId,
        workspaceId: observed.workspaceId,
        stampSource: observed.stampSource,
        neonBranchId: observed.physical.neonBranchId,
        storageResolved: secrets.storage !== null,
        // Which of the four evidence states the key check cleared on. A fleet
        // where this reads `absent` everywhere is a fleet where the canary is
        // again the only thing being checked, and that is worth being able to
        // see rather than infer.
        storedCiphertext: observed.storedCiphertext,
      },
      'tenant database fingerprint verified'
    )
    return secrets
  }

  const parsed = parseSecretRef(tenant.database.credentialRef)
  if (parsed.scheme === 'neon+role') invalidateNeonRolePassword(parsed)
  // A refused pool must not leave a resolved bundle memoised: the commonest
  // recoverable cause is a rotation mid-flight, and the retry has to re-resolve
  // rather than re-fail on the value that was already wrong.
  clearTenantSecretsCache(tenant.tenantId)

  log.error(
    {
      tenantId: tenant.tenantId,
      code: keyVerdict.code,
      detail: keyVerdict.detail,
      observedWorkspaceId: observed.workspaceId,
      observedBranchId: observed.physical.neonBranchId,
      expectedBranchId: tenant.physical.neonBranchId,
    },
    'tenant database fingerprint REFUSED'
  )
  throw new TenantFingerprintRefusal(tenant.tenantId, keyVerdict.code, keyVerdict.detail)
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

/**
 * A tenant's own **direct** (session-mode) pool, outside this cache.
 *
 * The outbox relay tier needs three things this cache cannot give it: the
 * *direct* endpoint (a transaction pooler accepts a `LISTEN` and delivers
 * nothing, and a session advisory lock is worse than useless through one), a
 * connection that is never evicted by request-traffic LRU pressure, and a
 * lifetime it controls. So it opens its own — but through this module, because
 * this is the layer that builds `Database` handles and, more importantly,
 * because the §3 assertion must be the *same* assertion. A second copy of a
 * fail-closed identity check is a second copy that can drift open.
 *
 * Deliberately NOT registered in `pools`: this handle is not a request pool, it
 * must not be handed to a request, and it must not be counted in the eviction
 * metric that measures whether idle tenants can suspend. §6's corollary is that
 * the tier holding it must never share a compute with tenants you expect to
 * suspend, and keeping it out of that counter is what keeps the counter honest.
 *
 * Throws on refusal, exactly as `acquireTenantPool` does. The caller decides
 * what a refused tenant costs; for the relay tier it costs that tenant its relay
 * and nothing else.
 */
export interface DirectTenantPool {
  sql: postgres.Sql
  db: Database
  secrets: ResolvedTenantSecrets
  close(): Promise<void>
}

export async function openTenantDirectPool(
  tenant: TenantDescriptor,
  opts: { max?: number } = {}
): Promise<DirectTenantPool> {
  const sql = postgres(tenant.database.directUrl, {
    max: opts.max ?? 1,
    // An always-warm tier: letting the connection lapse would pay a reconnect on
    // every wake, and the whole point of the doorbell is that work starts now.
    idle_timeout: 0,
    connect_timeout: 15,
    prepare: true,
    password: () => resolvePassword(tenant),
    onnotice: () => {},
  })
  try {
    const secrets = await verifyTenantDatabase(tenant, sql)
    return {
      sql,
      db: createDbFromSql(sql),
      secrets,
      close: () =>
        sql
          .end({ timeout: 5 })
          .then(() => undefined)
          .catch(() => undefined),
    }
  } catch (err) {
    await sql.end({ timeout: 5 }).catch(() => {})
    throw err
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
