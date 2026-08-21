/**
 * The tenant-keyed connection-pool cache.
 *
 * One process, many tenants, one database each. This is the LRU that turns a
 * resolved tenant record into a live `postgres.js` pool, and it is where the
 * fingerprint assertion is enforced — once per pool, not once per request.
 *
 * Eviction here is plain hygiene: an idle tenant's pool object and sockets are
 * bounded resources on a process serving many tenants, nothing more. The LRU
 * cap bounds how many pools exist at once; the idle sweep drops pools nothing
 * has touched for a while.
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
import type { TenantDescriptor } from './registry'
import { clearTenantSecretsCache, resolveTenantSecrets } from './tenant-secrets'
import { openTenantSecret } from './vendor/fleet-secrets'
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
}

export interface PoolCacheStats {
  live: number
  created: number
  evicted: number
  evictedByReason: Record<string, number>
  refusals: number
}

export function getPoolCacheStats(): PoolCacheStats {
  return {
    live: pools.size,
    created: stats.created,
    evicted: stats.evicted,
    evictedByReason: { ...stats.evictedByReason },
    refusals: stats.refusals,
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
    // Small on purpose. One instance holds N tenant pools, so per-tenant
    // socket counts multiply across the fleet against one server's (or one
    // pooler's) connection budget.
    max: config.tenantPoolMax,
    // Keep protocol-level prepared statements. Through transaction-mode
    // pgbouncer this requires `max_prepared_statements` (pgbouncer 1.21+); the
    // escape hatch for older poolers is the `prepare` option in
    // @quackback/db/client.
    prepare: true,
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
 * Exported because the realtime listener's `LISTEN` connection terminates at
 * the **direct** endpoint rather than at the pooled one, so it is built outside
 * this cache and still needs the same credential — resolved by the same
 * function so a rotation cannot be picked up by one path and missed by the
 * other.
 */
export async function resolveTenantPassword(tenant: TenantDescriptor): Promise<string> {
  return resolvePassword(tenant)
}

/** A database-credential refusal that carries its quarantine code. */
class DbCredentialError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DbCredentialError'
  }
}

async function resolvePassword(tenant: TenantDescriptor): Promise<string> {
  const ref = tenant.database.credentialRef
  const parsed = parseSecretRef(ref)
  switch (parsed.scheme) {
    case 'sealed+aead': {
      // The control plane issues the role password (`CREATE ROLE … PASSWORD`)
      // and seals it under the fleet root, in the same registry row as the DSN.
      if (parsed.purpose !== 'db') {
        throw new DbCredentialError(
          'ref_purpose_mismatch',
          `${redactRef(ref)} is sealed for '${parsed.purpose}', not a database password`
        )
      }
      if (parsed.tenantId !== tenant.tenantId) {
        throw new DbCredentialError(
          'ref_tenant_mismatch',
          `${redactRef(ref)} is sealed for ${parsed.tenantId} but sits on ${tenant.tenantId}`
        )
      }
      const rootKey = config.fleetRootKey
      if (!rootKey) {
        throw new DbCredentialError(
          'root_key_missing',
          `${redactRef(ref)} needs QUACKBACK_FLEET_ROOT_KEY to open, and it is unset`
        )
      }
      return openTenantSecret(
        rootKey,
        { generation: parsed.generation, tenantId: parsed.tenantId, purpose: 'db' },
        parsed.blob
      )
    }
    case 'env': {
      const value = process.env[parsed.variable]
      if (!value) {
        throw new Error(`${redactRef(ref)} names ${parsed.variable}, which is unset`)
      }
      return value
    }
    default:
      // The contract parses this scheme, but not as a DATABASE credential.
      // Refusing by name keeps the failure terminal (quarantine, not a
      // reconnect loop) and honest about the cause.
      throw new DbCredentialError(
        'db_credential_no_resolver',
        `${redactRef(ref)}: no database-credential resolver for ${parsed.scheme}:// in this build`
      )
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
 * Shared by the request pool cache and by `assertTenantDirectDatabase` below,
 * so the pooled and direct paths cannot disagree about whether a database
 * really is the tenant the registry named. A second copy of a fail-closed
 * identity check is a second copy that can drift open.
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
  const verdict = evaluateTenantIdentity(tenant.fingerprint, observed)
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
 * The same fail-closed identity assertion, for a connection built OUTSIDE this
 * cache.
 *
 * A `LISTEN`-holding consumer (the realtime bus) needs the *direct* endpoint
 * (a transaction pooler accepts a `LISTEN` and delivers nothing), a connection
 * that is never evicted by request-traffic LRU pressure, and a lifetime it
 * controls — so it owns its connection. But the identity question is the same
 * one this cache answers before serving a pool, and it must be the *same*
 * assertion: a listener on a mispointed `directUrl` would read another
 * tenant's `realtime_overflow` rows and deliver them to this tenant's streams,
 * fail-open. A second copy of a fail-closed identity check is a second copy
 * that can drift open, so this is a window onto the one implementation.
 *
 * Throws on refusal, exactly as `acquireTenantPool` does.
 */
export async function assertTenantDirectDatabase(
  tenant: TenantDescriptor,
  sql: postgres.Sql
): Promise<void> {
  await verifyTenantDatabase(tenant, sql)
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
 * `postgres.js` already closes idle *sockets* after `idle_timeout`. This sweep
 * additionally drops the pool object, which is what stops a tenant that was
 * routed here once from holding a slot in the LRU forever.
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
  // Never hold the process open.
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
