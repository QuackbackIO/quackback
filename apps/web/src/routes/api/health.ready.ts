import { createFileRoute } from '@tanstack/react-router'
import { db, sql, getMigrationStatus } from '@/lib/server/db'
// The mode is read from the environment rather than through `config`: the
// readiness probe must not fail because some unrelated variable is missing —
// that would report the process unhealthy for a reason it is not.
import { isPooledTenancy } from '@/lib/server/tenancy/mode'
import { getJobTierStatus } from '@/lib/server/jobs/tier'
import { getProcessRole, shouldRunWorkers } from '@/lib/server/process-role'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'health' })

/** Per-check budget so a hung dependency degrades the probe instead of hanging it. */
const CHECK_TIMEOUT_MS = 3_000

/** Public probe body: booleans and short codes only, never error detail. */
interface CheckResult {
  ok: boolean
  error?: 'failed' | 'timeout' | 'behind'
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
  // control store — without it no hostname resolves at all.
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
 * There is deliberately NO readiness check for MIN_SCHEMA_VERSION or
 * QUACKBACK_ROLE.
 *
 * `boot-config.ts` validates both at server entry and exits non-zero, so a
 * process serving this route cannot have bad configuration — a check for it
 * would be unreachable code that reads as coverage. An earlier version had one,
 * and it was only ever reachable from a test harness that skipped the boot path;
 * a branch that runs nowhere else is worse than no branch, because it invites
 * the next reader to believe the case is handled.
 */
async function checkMigrations(): Promise<void> {
  // Fleet readiness deliberately asserts nothing about tenant schemas under
  // pooled tenancy. The memo below is actively
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
 *
 * ## Every check here names a dependency the process needs to serve
 *
 * There used to be a fourth, pinging Redis. It was removed with Redis itself,
 * and the direction of that change is worth stating because dropping a
 * conjunct from a health signal normally makes it weaker: this one asserted
 * the reachability of a store no request path reads. The cache, the rate
 * buckets, the presence sets and the queues are all tables in the tenant's own
 * database now, so what used to be "is Redis up" is already covered by `db` —
 * and the check could only ever have been a FALSE 503, taking a pod that was
 * serving perfectly out of rotation because a store nothing reads was down.
 *
 * What remains, and what each one fails on:
 *
 *   db          the control store (pooled) or the single database — the thing
 *               every request needs. Down or slow ⇒ 503.
 *   migrations  single-tenant only: the applied ledger is behind the bundled
 *               one, so this build's queries can hit columns that do not exist
 *               yet ⇒ 503 `behind`. Pooled skips it deliberately.
 *   workers     a worker-role process that is not running the job tier ⇒ 503.
 *
 * A hung dependency still degrades rather than hangs: `runCheck` gives each one
 * `CHECK_TIMEOUT_MS` and reports `timeout`.
 */
export async function handleReadinessProbe(): Promise<Response> {
  const [dbCheck, migrationsCheck] = await Promise.all([
    runCheck('db', checkDb),
    runCheck('migrations', checkMigrations),
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
    // Tenants being refused. Deliberately reported here and NOT allowed to fail
    // the probe: a bad registry record is not this replica's fault, and taking
    // the pod out of rotation for it would turn one tenant's misconfiguration
    // into a fleet-wide outage. The detail — which tenant, which code, how long
    // — is on the quarantine heartbeat in the logs; this is the number that says
    // to go and read it.
    refused: tier.tenants.filter((t) => Boolean(t.refusedCode)).length,
  }

  const ready = dbCheck.ok && migrationsCheck.ok && workersCheck.ok
  return Response.json(
    {
      status: ready ? 'ok' : 'unavailable',
      role: getProcessRole(),
      checks: {
        db: dbCheck,
        migrations: migrationsCheck,
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
