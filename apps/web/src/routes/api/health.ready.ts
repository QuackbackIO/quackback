import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
import { db, sql, getMigrationStatus } from '@/lib/server/db'
import { getControlSql } from '@/lib/server/tenancy/registry'
import { getQueueRedis } from '@/lib/server/queue/redis-config'
import { getWorkerBootStatus } from '@/lib/server/queue/worker-registry'
import { getProcessRole } from '@/lib/server/queue/role'
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
  // control store — without it no hostname resolves at all. Probing a tenant
  // would also be actively harmful: it would wake a suspended Neon compute
  // every few seconds, defeating the idle-cost model the pooling exists for.
  if (config.isPooledTenancy) {
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

async function checkMigrations(): Promise<void> {
  // Fleet readiness stops asserting anything about tenant schemas under pooled
  // tenancy, per SAAS-HOSTING-STACK.md §10.5. The memo below is actively
  // misleading there: it caches "migrations OK" forever after the first tenant
  // it happened to see, so the probe goes blind during exactly the rolling
  // migration it exists to catch. A tenant mid-migration must degrade alone —
  // that is the per-tenant `MIN_SCHEMA_VERSION` gate's job, not the probe's.
  if (config.isPooledTenancy) return
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
  const [dbCheck, redisCheck, migrationsCheck] = await Promise.all([
    runCheck('db', checkDb),
    runCheck('redis', checkRedis),
    runCheck('migrations', checkMigrations),
  ])
  // On web-role replicas no workers boot, so the check passes with zero
  // counts — the role field says which reading you're looking at.
  const bootStatus = getWorkerBootStatus()
  const workersCheck = { ok: bootStatus.failed === 0, ...bootStatus }

  const ready = dbCheck.ok && redisCheck.ok && migrationsCheck.ok && workersCheck.ok
  return Response.json(
    {
      status: ready ? 'ok' : 'unavailable',
      role: getProcessRole(),
      checks: {
        db: dbCheck,
        redis: redisCheck,
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
