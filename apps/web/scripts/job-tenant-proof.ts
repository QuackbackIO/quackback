/**
 * Evidence harness for the queue's tenant boundary, run against a real pooled
 * fleet (`QUACKBACK_TENANCY=pooled`, a real control-plane registry, one Neon
 * database per tenant).
 *
 * The queue is per-tenant by construction — the table lives in the tenant's own
 * database, so there is no shared queue to route out of. That is a structural
 * argument, and SAAS-HOSTING-STACK.md §3 is precisely the observation that a
 * wrong-tenant answer passes every structural check without erroring. So this
 * harness does not argue; it measures, in both directions.
 *
 * What each executed job records, into a scratch table in **whatever database
 * `db` actually resolved to**:
 *
 *   - the tenant id the scope claimed  (`getCurrentTenant()`)
 *   - `current_database()` and `neon.branch_id` of the database written to
 *
 * A cross-tenant execution is then observable two independent ways, and neither
 * requires trusting the other:
 *
 *   1. an effect row appears in a tenant's database for a job enqueued into a
 *      different tenant's database; or
 *   2. an effect row's recorded scope id does not match the tenant that owns
 *      the database the row is sitting in.
 *
 * Both orderings are run. A cache or a pool that is last-writer-wins is
 * asymmetric, and testing one direction leaves detection to whichever tenant's
 * value happened to survive.
 *
 * Usage:
 *   env $(cat pooled.env) bun run scripts/job-tenant-proof.ts run
 *   env ... bun run scripts/job-tenant-proof.ts listen-endpoints   (§7.3 re-check)
 *   env ... bun run scripts/job-tenant-proof.ts cleanup
 */
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { listActiveTenants, type TenantDescriptor } from '@/lib/server/tenancy/registry'
import { resolveTenantPassword } from '@/lib/server/tenancy/pool-cache'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { getCurrentTenant } from '@/lib/server/tenancy/tenant-context'
import { __setJobDefinitionsForTests } from '@/lib/server/jobs/definitions'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { getJobTierStatus, startJobTier, stopJobTier } from '@/lib/server/jobs/tier'
import { openWakeListener } from '@/lib/server/jobs/wake'

const args = process.argv.slice(2)
const command = args[0] ?? 'run'
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

const EFFECTS = `
  CREATE TABLE IF NOT EXISTS gauntlet_tenant_effects (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id text NOT NULL,
    queue text NOT NULL,
    enqueued_for text NOT NULL,
    scope_tenant_id text,
    db_name text NOT NULL,
    branch_id text,
    at timestamptz NOT NULL DEFAULT now()
  )
`

interface EffectRow {
  job_id: string
  queue: string
  enqueued_for: string
  scope_tenant_id: string | null
  db_name: string
  branch_id: string | null
}

async function effectsIn(tenantId: string): Promise<EffectRow[]> {
  return withTenantScopeById(tenantId, 'script', async () => {
    const res = await db.execute(sql`
      SELECT job_id, queue, enqueued_for, scope_tenant_id, db_name, branch_id
      FROM gauntlet_tenant_effects ORDER BY id
    `)
    return getExecuteRows<EffectRow>(res)
  })
}

async function run(): Promise<void> {
  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) console.log('refused registry records:', refused)
  if (tenants.length < 2) {
    console.error(`need at least two active tenants, found ${tenants.length}`)
    process.exit(2)
  }
  const wantA = flag('a')
  const wantB = flag('b')
  const pick = (id: string | undefined, fallback: TenantDescriptor): TenantDescriptor => {
    if (!id) return fallback
    const found = tenants.find((t) => t.tenantId === id)
    if (!found) throw new Error(`tenant ${id} is not active in the registry`)
    return found
  }
  const a = pick(wantA, tenants[0])
  const b = pick(wantB, tenants[1])
  if (a.tenantId === b.tenantId) throw new Error('the two tenants must differ')
  console.log(
    `tenants: ${a.tenantId} (${a.database.directUrl}) | ${b.tenantId} (${b.database.directUrl})`
  )

  for (const t of [a, b]) {
    await withTenantScopeById(t.tenantId, 'script', async () => {
      await db.execute(sql.raw(EFFECTS))
      await db.execute(sql`DELETE FROM gauntlet_tenant_effects`)
      await db.execute(sql`DELETE FROM job_queue WHERE queue LIKE 'tenantproof-%'`)
    })
  }

  const stamp = Date.now().toString(36)
  const queue = `tenantproof-${stamp}`

  __setJobDefinitionsForTests([
    {
      name: queue,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        const scope = getCurrentTenant()?.tenantId ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_tenant_effects
            (job_id, queue, enqueued_for, scope_tenant_id, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue},
                 ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? '?')},
                 ${scope}, current_database(), current_setting('neon.branch_id', true)
        `)
      },
    },
  ])

  await startJobTier()
  console.log(
    'job tier started; loops =',
    getJobTierStatus().tenants.map((t) => t.tenantId)
  )

  // ---- both orderings, one tenant at a time -------------------------------
  const enqueued: Array<{ tenantId: string; jobId: string }> = []
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as Array<[TenantDescriptor, TenantDescriptor]>) {
    const res = await withTenantScopeById(first.tenantId, 'script', () =>
      enqueueJob({
        queue,
        payload: { enqueuedFor: first.tenantId },
        maxAttempts: 1,
        dedupeKey: `${first.tenantId}-${second.tenantId}`,
      })
    )
    enqueued.push({ tenantId: first.tenantId, jobId: res.jobId })
    console.log(`enqueued ${res.jobId} for ${first.tenantId} only`)
    await new Promise((r) => setTimeout(r, 4_000))
  }

  // ---- the wrong-tenant row: planted, must never execute ------------------
  const plantedQueue = `${queue}-planted`
  __setJobDefinitionsForTests([
    ...[
      {
        name: queue,
        maxAttempts: 1,
        leaseMs: 30_000,
        handler: async () => async (job: { jobId: string; queue: string; payload: unknown }) => {
          const scope = getCurrentTenant()?.tenantId ?? null
          await db.execute(sql`
            INSERT INTO gauntlet_tenant_effects
              (job_id, queue, enqueued_for, scope_tenant_id, db_name, branch_id)
            SELECT ${job.jobId}, ${job.queue},
                   ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? '?')},
                   ${scope}, current_database(), current_setting('neon.branch_id', true)
          `)
        },
      },
    ],
    {
      name: plantedQueue,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        const scope = getCurrentTenant()?.tenantId ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_tenant_effects
            (job_id, queue, enqueued_for, scope_tenant_id, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue}, 'PLANTED', ${scope},
                 current_database(), current_setting('neon.branch_id', true)
        `)
      },
    },
  ])

  await withTenantScopeById(a.tenantId, 'script', async () => {
    await enqueueJob({ queue: plantedQueue, payload: {}, maxAttempts: 1, dedupeKey: 'planted' })
    // Restamp it as the OTHER tenant's job, in A's own database.
    await db.execute(sql`
      UPDATE job_queue SET tenant_id = ${b.tenantId}
      WHERE queue = ${plantedQueue} AND dedupe_key = 'planted'
    `)
  })
  console.log(`planted a row in ${a.tenantId}'s queue stamped for ${b.tenantId}`)
  await new Promise((r) => setTimeout(r, 6_000))

  await stopJobTier()

  // ---- verdict ------------------------------------------------------------
  let crossTenant = 0
  const owner = new Map<string, string>()
  for (const t of [a, b]) owner.set(t.tenantId, t.tenantId)

  console.log('')
  for (const t of [a, b]) {
    const rows = await effectsIn(t.tenantId)
    console.log(`--- effects recorded IN ${t.tenantId} (${rows.length}) ---`)
    for (const r of rows) {
      const enqueuedElsewhere = r.enqueued_for !== t.tenantId
      const scopeMismatch = r.scope_tenant_id !== t.tenantId
      const bad = enqueuedElsewhere || scopeMismatch
      if (bad) crossTenant += 1
      console.log(
        `  job=${r.job_id} queue=${r.queue} enqueued_for=${r.enqueued_for} ` +
          `scope=${r.scope_tenant_id} db=${r.db_name} branch=${r.branch_id} ` +
          `${bad ? '  <-- CROSS-TENANT' : ''}`
      )
    }
  }

  // The planted row's fate.
  const planted = await withTenantScopeById(a.tenantId, 'script', async () => {
    const res = await db.execute(sql`
      SELECT status, last_error, attempts FROM job_queue WHERE queue = ${plantedQueue}
    `)
    return getExecuteRows<{ status: string; last_error: string; attempts: number }>(res)[0]
  })
  console.log('')
  console.log(`planted row: status=${planted?.status} attempts=${planted?.attempts}`)
  console.log(`             last_error=${planted?.last_error}`)

  const plantedRan = (await effectsIn(a.tenantId)).some((r) => r.enqueued_for === 'PLANTED')
  const plantedRanB = (await effectsIn(b.tenantId)).some((r) => r.enqueued_for === 'PLANTED')

  console.log('')
  console.log(`cross-tenant observations: ${crossTenant}`)
  console.log(`planted wrong-tenant job executed anywhere: ${plantedRan || plantedRanB}`)

  // Positive control: the harness has to be able to SEE an effect at all. Two
  // executions were expected, one per tenant, each in its own database.
  const total = (await effectsIn(a.tenantId)).length + (await effectsIn(b.tenantId)).length
  const legit = total - (plantedRan || plantedRanB ? 1 : 0)
  console.log(`legitimate executions observed: ${legit} (expected 2 — one per tenant)`)
  if (legit !== 2) {
    console.log('')
    console.log('CONTROL FAILED — the expected per-tenant executions were not observed, so a')
    console.log('"zero cross-tenant" result here would be a result from a surface that ran')
    console.log('nothing. Fix the fixture before reading the verdict.')
    process.exit(3)
  }
  if (crossTenant > 0 || plantedRan || plantedRanB) {
    console.log('FAIL')
    process.exit(1)
  }
  console.log('PASS — every job executed against exactly its own tenant database.')
}

/**
 * The §7.3 re-check, for this queue's own channel: does `LISTEN` on the queue
 * wake channel actually deliver through Neon's pooled endpoint?
 *
 * Measured by sending a NOTIFY and waiting for it. Never by asking
 * `pg_listening_channels()`, which reports the registration as present on a
 * pooled connection that delivers nothing.
 */
async function listenEndpoints(): Promise<void> {
  const { tenants } = await listActiveTenants()
  const only = (flag('only') ?? '').split(',').filter(Boolean)
  for (const t of tenants) {
    if (only.length > 0 && !only.includes(t.tenantId)) continue
    for (const [label, url] of [
      ['direct', t.database.directUrl],
      ['pooled', t.database.pooledUrl],
    ] as const) {
      let delivered: boolean
      try {
        const listener = await openWakeListener({
          directUrl: url,
          password: () => resolveTenantPassword(t),
          label: `${t.tenantId}:${label}`,
          onWake: () => {},
        })
        delivered = await listener.verify(6_000)
        await listener.close()
      } catch (err) {
        console.log(`${t.tenantId} ${label}: ERROR ${(err as Error).message}`)
        continue
      }

      // The false-green instrument, reported alongside so the difference is on
      // the record rather than in a footnote.
      const pw = await resolveTenantPassword(t)
      const s = postgres(url, { max: 1, password: () => Promise.resolve(pw), onnotice: () => {} })
      let catalogueSays: boolean
      try {
        await s.listen('quackback_job_wake', () => {})
        const rows = await s<{ ok: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_listening_channels() AS c WHERE c = 'quackback_job_wake'
          ) AS ok
        `
        catalogueSays = rows[0]?.ok ?? false
      } catch {
        catalogueSays = false
      } finally {
        await s.end({ timeout: 5 }).catch(() => {})
      }

      console.log(
        `${t.tenantId.padEnd(24)} ${label.padEnd(7)} ` +
          `notify_delivered=${String(delivered).padEnd(6)} pg_listening_channels_says=${catalogueSays}`
      )
    }
  }
}

async function cleanup(): Promise<void> {
  const { tenants } = await listActiveTenants()
  for (const t of tenants) {
    await withTenantScopeById(t.tenantId, 'script', async () => {
      await db.execute(sql`DROP TABLE IF EXISTS gauntlet_tenant_effects`)
      await db.execute(sql`DELETE FROM job_queue WHERE queue LIKE 'tenantproof-%'`)
    })
    console.log(`cleaned ${t.tenantId}`)
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'run':
      return run()
    case 'listen-endpoints':
      return listenEndpoints()
    case 'cleanup':
      return cleanup()
    default:
      console.log('commands: run | listen-endpoints | cleanup')
      process.exit(2)
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
