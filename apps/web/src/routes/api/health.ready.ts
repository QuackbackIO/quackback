import { createFileRoute } from '@tanstack/react-router'
import { db, sql, getMigrationStatus } from '@/lib/server/db'
// `UnknownSchemaVersion` comes through the fleet module rather than straight
// from `@quackback/db/*`: that package is reserved for the re-export layer, and
// schema-floor.ts already re-exports it for exactly this reason.
import { assertSchemaFloorConfigured, UnknownSchemaVersion } from '@/lib/server/fleet/schema-floor'
// The mode is read from the environment rather than through `config`: the
// readiness probe must not fail because some unrelated variable is missing —
// that would report the process unhealthy for a reason it is not.
import { isPooledTenancy } from '@/lib/server/tenancy/mode'
import { getQueueRedis } from '@/lib/server/queue/redis-config'
import { getJobTierStatus } from '@/lib/server/jobs/tier'
import {
  assertProcessRoleConfigured,
  getProcessRole,
  InvalidProcessRole,
  shouldRunWorkers,
} from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'health' })

/** Per-check budget so a hung dependency degrades the probe instead of hanging it. */
const CHECK_TIMEOUT_MS = 3_000

/** Public probe body: booleans and short codes only, never error detail. */
interface CheckResult {
  ok: boolean
  error?: 'failed' | 'timeout' | 'behind' | 'misconfigured'
}

class CheckTimeout extends Error {}
class MigrationsBehind extends Error {}

async function runCheck(name: string, check: () => Promise<void>): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = check()
    // Swallow a late rejection if the timeout already won the race.
    pending.catch(() => {})
    await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CheckTimeout()), CHECK_TIMEOUT_MS)
      }),
    ])
    return { ok: true }
  } catch (err) {
    if (err instanceof CheckTimeout) return { ok: false, error: 'timeout' }
    if (err instanceof MigrationsBehind) return { ok: false, error: 'behind' }
    // A configuration fault is not a dependency fault, and the difference is
    // the whole triage: `failed` sends someone to look at the database, which
    // is fine and is not the problem. The code names the CLASS only — never the
    // value — so an unauthenticated probe still leaks nothing.
    if (err instanceof UnknownSchemaVersion || err instanceof InvalidProcessRole) {
      log.error({ err, check: name }, 'readiness check failed: this process is misconfigured')
      return { ok: false, error: 'misconfigured' }
    }
    // Full detail goes to the log; the response carries a short code only.
    log.warn({ err, check: name }, 'readiness check failed')
    return { ok: false, error: 'failed' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDb(): Promise<void> {
  // Under pooled tenancy the probe carries no tenant, so there is no "the"
  // database to ping. What the fleet's readiness actually depends on is the
  // control store — without it no hostname resolves at all. Probing a tenant
  // would also be actively harmful: it would wake a suspended Neon compute
  // every few seconds, defeating the idle-cost model the pooling exists for.
  if (isPooledTenancy()) {
    // Imported here rather than at module scope: a single-tenant probe must not
    // drag the tenancy stack (and `postgres`) into its module graph for a branch
    // it never takes.
    const { getControlSql } = await import('@/lib/server/tenancy/registry')
    await getControlSql()`SELECT 1`
    return
  }
  await db.execute(sql`SELECT 1`)
}

async function checkRedis(): Promise<void> {
  await getQueueRedis().ping()
}

// The bundled journal is frozen at build time and applied rows only grow,
// so a passing check can never regress in-process: cache the success and
// keep querying only while behind (a pod flips ready once the migrator
// catches up).
let migrationsKnownUpToDate = false

/** Test seam: clears the memoized migration result between cases. */
export function resetReadinessCache(): void {
  migrationsKnownUpToDate = false
}

/**
 * The process's own serving floor, not any tenant's schema.
 *
 * `checkMigrations` deliberately asserts nothing about tenant schemas under
 * pooled tenancy (§10.5), and that stays true. This is a different question:
 * `MIN_SCHEMA_VERSION` naming no bundled migration means this replica will
 * refuse **every** tenant, so it is not ready — and without this the failure is
 * invisible to the probe and shows up as a fleet-wide outage with a green
 * deploy.
 */
function checkSchemaFloor(): void {
  assertSchemaFloorConfigured()
  // Same class of fault, same reasoning: an unrecognised QUACKBACK_ROLE means
  // this replica is not doing the job its deployment thinks it is.
  assertProcessRoleConfigured()
}

async function checkMigrations(): Promise<void> {
  // Fleet readiness stops asserting anything about tenant schemas under pooled
  // tenancy, per SAAS-HOSTING-STACK.md §10.5. The memo below is actively
  // misleading there: it caches "migrations OK" forever after the first tenant
  // it happened to see, so the probe goes blind during exactly the rolling
  // migration it exists to catch. A tenant mid-migration must degrade alone —
  // that is the per-tenant `MIN_SCHEMA_VERSION` gate's job, not the probe's.
  if (isPooledTenancy()) return
  if (migrationsKnownUpToDate) return
  const status = await getMigrationStatus(db)
  if (!status.upToDate) throw new MigrationsBehind()
  migrationsKnownUpToDate = true
}

/**
 * Readiness probe: 200 when every dependency check passes, 503 with a
 * per-check breakdown otherwise. Workers still booting don't fail the
 * probe; a worker whose init failed does.
 */
export async function handleReadinessProbe(): Promise<Response> {
  const [dbCheck, redisCheck, migrationsCheck, schemaFloorCheck] = await Promise.all([
    runCheck('db', checkDb),
    runCheck('redis', checkRedis),
    runCheck('migrations', checkMigrations),
    runCheck('schema_floor', async () => checkSchemaFloor()),
  ])
  // Background work is now one tier rather than a registry of BullMQ workers,
  // so readiness reports the tier.
  //
  // **`ok` asserts something now.** The old check computed
  // `ok = bootStatus.failed === 0` over eagerly-initialised workers, and a
  // worker that was never *constructed* is not failed — so a pooled replica
  // that started no consumer at all reported `workers ok:true total:0` while
  // every queue silently accumulated. Here a worker-role process that is not
  // running the tier is NOT ready, and `loops` says how many tenants it is
  // actually serving, which zero would have made obvious.
  const tier = getJobTierStatus()
  const expected = shouldRunWorkers()
  const workersCheck = {
    ok: expected ? tier.running : true,
    expected,
    running: tier.running,
    loops: tier.tenants.length,
    inFlight: tier.tenants.reduce((n, t) => n + t.inFlight, 0),
    schemaMissing: tier.tenants.filter((t) => t.schemaMissing).length,
  }

  const ready =
    dbCheck.ok && redisCheck.ok && migrationsCheck.ok && schemaFloorCheck.ok && workersCheck.ok
  return Response.json(
    {
      status: ready ? 'ok' : 'unavailable',
      role: getProcessRole(),
      checks: {
        db: dbCheck,
        redis: redisCheck,
        migrations: migrationsCheck,
        schema_floor: schemaFloorCheck,
        workers: workersCheck,
      },
    },
    { status: ready ? 200 : 503 }
  )
}

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: () => handleReadinessProbe(),
    },
  },
})
