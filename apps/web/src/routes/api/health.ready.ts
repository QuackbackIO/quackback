import { createFileRoute } from '@tanstack/react-router'
import { db, sql, getMigrationStatus } from '@/lib/server/db'
// The mode is read from the environment rather than through `config`: the
// readiness probe must not fail because some unrelated variable is missing —
// that would report the process unhealthy for a reason it is not.
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
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

/**
 * How long a successful registry read stands in for a live probe.
 *
 * Longer than the platform's suspend timer on purpose. Anything shorter and the
 * probe becomes the client that keeps the control compute awake — see below.
 */
const CONTROL_OBSERVATION_TTL_MS = 600_000

async function checkDb(): Promise<void> {
  // Under pooled workspaces the probe carries no workspace, so there is no "the"
  // database to ping. What the fleet's readiness actually depends on is the
  // control store — without it no hostname resolves at all. Probing a workspace
  // would also be actively harmful: it would wake a suspended Neon compute
  // every few seconds, defeating the idle-cost model the pooling exists for.
  //
  // The control store now has exactly the same problem, and it used to have it
  // from this line. `SELECT 1` on every poll is a client connected every few
  // seconds, which is why that compute measured 95% active for a day while
  // doing nothing. So the probe **observes rather than connects**: the registry
  // records the outcome of every real read, and a recent success is better
  // evidence than a synthetic one — it is the actual query the request path
  // depends on, against the actual pool, rather than a `SELECT 1` that can pass
  // while the registry tables are unreadable.
  //
  // A real connection is still made in the one case where observation says
  // nothing: no read has succeeded within the window. That covers boot, where
  // readiness genuinely must not pass until the control database has answered,
  // and it covers a fleet so quiet that the last read has aged out — at which
  // point one connection every ten minutes is a rounding error against a suspend
  // timer measured in minutes.
  if (isPooledTenancy()) {
    // Imported here rather than at module scope: a single-workspace probe must not
    // drag the workspaces stack (and `postgres`) into its module graph for a branch
    // it never takes.
    const { probeControlDatabase, getControlReadState } =
      await import('@/lib/server/workspaces/registry')
    const state = getControlReadState()
    const now = Date.now()
    // A failure that is newer than the last success is the current truth, and it
    // must fail the probe rather than be aged out by a stale success.
    if (state.lastOkAt > state.lastErrorAt && now - state.lastOkAt < CONTROL_OBSERVATION_TTL_MS) {
      return
    }
    await probeControlDatabase()
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
  // Fleet readiness stops asserting anything about workspace schemas under pooled
  // workspaces, per SAAS-HOSTING-STACK.md §10.5. The memo below is actively
  // misleading there: it caches "migrations OK" forever after the first workspace
  // it happened to see, so the probe goes blind during exactly the rolling
  // migration it exists to catch. A workspace mid-migration must degrade alone —
  // that is the per-workspace `MIN_SCHEMA_VERSION` gate's job, not the probe's.
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
 * buckets, the presence sets and the queues are all tables in the workspace's own
 * database now, so what used to be "is Redis up" is already covered by `db` —
 * and the check could only ever have been a FALSE 503, taking a pod that was
 * serving perfectly out of rotation because a store nothing reads was down.
 *
 * What remains, and what each one fails on:
 *
 *   db          the control store (pooled) or the single database — the thing
 *               every request needs. Down or slow ⇒ 503.
 *   migrations  single-workspace only: the applied ledger is behind the bundled
 *               one, so this build's queries can hit columns that do not exist
 *               yet ⇒ 503 `behind`. Pooled skips it deliberately (§10.5).
 *   workers     a process that should run workers (`worker` or `all`) but
 *               is not running the job tier ⇒ 503. `web` does not expect it.
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
  // running the tier is NOT ready, and `loops` says how many workspaces it is
  // actually serving, which zero would have made obvious.
  const tier = getJobTierStatus()
  const expected = shouldRunWorkers()
  const workersCheck = {
    ok: expected ? tier.running : true,
    expected,
    running: tier.running,
    loops: tier.workspaces.length,
    inFlight: tier.workspaces.reduce((n, t) => n + t.inFlight, 0),
    schemaMissing: tier.workspaces.filter((t) => t.schemaMissing).length,
    // Workspaces this process currently holds connections for. `attached: 0` with
    // `loops` non-zero is the healthy idle fleet, and the two together are the
    // only place an operator can see that the cost model is working — detaching
    // has no other symptom.
    attached: tier.workspaces.filter((t) => t.attached).length,
    // Workspaces being refused. Deliberately reported here and NOT allowed to fail
    // the probe: a bad registry record is not this replica's fault, and taking
    // the pod out of rotation for it would turn one workspace's misconfiguration
    // into a fleet-wide outage. The detail — which workspace, which code, how long
    // — is on the quarantine heartbeat in the logs; this is the number that says
    // to go and read it.
    refused: tier.workspaces.filter((t) => Boolean(t.refusedCode)).length,
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
