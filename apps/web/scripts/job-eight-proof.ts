/**
 * The eight migrated queues, on a real two-tenant pooled fleet.
 *
 * `job-tenant-proof.ts` established the boundary with a synthetic queue. This
 * one runs the **real registry** — every definition's real name, concurrency,
 * `maxAttempts`, lease and backoff — and enqueues through each queue's **real
 * producer function**, so what is exercised is the code the app calls.
 *
 * Every handler is wrapped rather than replaced: the wrapper records
 * `getCurrentTenant()`, `current_database()` and `neon.branch_id` into a
 * scratch table **in whichever database `db` actually resolved to**, and then
 * calls the real handler. A cross-tenant execution is observable two
 * independent ways, neither needing the other to be trusted:
 *
 *   1. an effect row appears in a tenant's database for a job enqueued into a
 *      different tenant's database; or
 *   2. an effect row's recorded scope does not match the tenant that owns the
 *      database the row is sitting in.
 *
 * Both orderings are run, because a last-writer-wins cache is asymmetric and
 * testing one direction leaves detection to whichever tenant happened to write
 * second.
 *
 * **The positive control matters as much as the verdict.** "Zero cross-tenant
 * observations" is also what a run in which nothing executed would report, so
 * the run fails unless every one of the eight produced an effect in *both*
 * tenants. If the control does not fire, that is the signal to look at.
 *
 * Usage:
 *   env $(cat pooled.env) bun run scripts/job-eight-proof.ts run --a <id> --b <id>
 *   env $(cat pooled.env) bun run scripts/job-eight-proof.ts cleanup
 */
import { sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { listActiveTenants, type TenantDescriptor } from '@/lib/server/tenancy/registry'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { getCurrentTenant } from '@/lib/server/tenancy/tenant-context'
import {
  JOB_DEFINITIONS,
  __setJobDefinitionsForTests,
  type JobDefinition,
} from '@/lib/server/jobs/definitions'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { getJobTierStatus, startJobTier, stopJobTier } from '@/lib/server/jobs/tier'
import { enqueueHookJobsWithIds } from '@/lib/server/events/process'
import { enqueueImportCommitJob } from '@/lib/server/domains/import/import-queue'
import { enqueueWorkspaceExportJob } from '@/lib/server/domains/export/export-queue'
import { enqueueHelpCenterTranslateJob } from '@/lib/server/domains/help-center/help-center-translate-queue'
import { enqueueWorkflowDispatch } from '@/lib/server/domains/workflows/workflow-dispatch-queue'
import { scheduleWorkflowResume } from '@/lib/server/domains/workflows/workflow-wait-queue'
import type { EventData } from '@/lib/server/events/types'

const args = process.argv.slice(2)
const command = args[0] ?? 'run'
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

/** The eight this piece moved. Named, not inferred, so the list is the claim. */
const EIGHT = [
  'events',
  'segment-evaluation',
  'help-center-translate',
  'email-imap',
  'workflow-dispatch',
  'workflow-wait',
  'import',
  'export',
] as const

const EFFECTS = `
  CREATE TABLE IF NOT EXISTS gauntlet_eight_effects (
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
      FROM gauntlet_eight_effects ORDER BY id
    `)
    return getExecuteRows<EffectRow>(res)
  })
}

/** Wrap every registered handler with the recorder, keeping every other field. */
function instrumentedDefinitions(marker: string): JobDefinition[] {
  return JOB_DEFINITIONS.map((def) => ({
    ...def,
    handler: async () => {
      const real = await def.handler()
      return async (job) => {
        const scope = getCurrentTenant()?.tenantId ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_eight_effects
            (job_id, queue, enqueued_for, scope_tenant_id, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue},
                 ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? marker)},
                 ${scope}, current_database(), current_setting('neon.branch_id', true)
        `)
        // Then the real handler. Most of these have no fixture in a bare tenant
        // database and will throw; the row above is written first precisely so
        // the boundary is observable regardless of the domain outcome.
        await real(job)
      }
    },
  }))
}

function probeEvent(tenantId: string): EventData {
  return {
    id: `evt-eightproof-${tenantId}-${Date.now()}`,
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'service', displayName: 'eight-proof' },
    data: { post: { id: 'post_probe', title: 'probe', boardId: 'b', boardSlug: 'b' } },
  } as unknown as EventData
}

/**
 * Enqueue one job on each of the eight, through each queue's real producer.
 *
 * The two exceptions are deliberate and named: `segment-evaluation`'s producer
 * is the scheduler itself (its schedules are rows), and `email-imap` refuses to
 * schedule under pooled tenancy on purpose — see its module header. Both are
 * enqueued directly so the queue is still exercised end to end.
 */
async function enqueueAllEight(tenantId: string): Promise<void> {
  const tag = { enqueuedFor: tenantId }
  await enqueueHookJobsWithIds([
    {
      name: 'post.created:__post_merge_recheck__',
      // A sentinel hook with no post id: the handler returns immediately, so
      // this exercises the real dispatch path without a fixture.
      data: {
        hookType: '__post_merge_recheck__',
        event: probeEvent(tenantId),
        target: null,
        config: {},
        ...tag,
      },
      jobId: `eightproof:${tenantId}:events`,
    },
  ])
  await enqueueJob({
    queue: 'segment-evaluation',
    payload: { segmentId: 'segment_eightproof_missing', ...tag },
    dedupeKey: `eightproof:${tenantId}:segment`,
    maxAttempts: 3,
  })
  await enqueueHelpCenterTranslateJob({
    type: 'translate-article',
    articleId: 'kb_eightproof_missing',
    locale: 'fr',
    ...tag,
  } as never)
  await enqueueJob({
    queue: 'email-imap',
    payload: tag,
    dedupeKey: `eightproof:${tenantId}:imap`,
    maxAttempts: 1,
  })
  await enqueueWorkflowDispatch({ ...probeEvent(tenantId), ...tag } as never)
  await scheduleWorkflowResume(`wfr_eightproof_${tenantId}`, 0, 1)
  await enqueueImportCommitJob({
    runId: 'imprun_eightproof_missing',
    source: 'csv',
    input: {},
    ...tag,
  } as never)
  await enqueueWorkspaceExportJob({
    runId: 'exprun_eightproof_missing',
    workspaceSlug: 'probe',
    ...tag,
  } as never)
}

async function pickTenants(): Promise<[TenantDescriptor, TenantDescriptor]> {
  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) console.log('refused registry records:', refused)
  const pick = (id: string | undefined, fallback: TenantDescriptor): TenantDescriptor => {
    if (!id) return fallback
    const found = tenants.find((t) => t.tenantId === id)
    if (!found) throw new Error(`tenant ${id} is not active in the registry`)
    return found
  }
  const a = pick(flag('a'), tenants[0])
  const b = pick(flag('b'), tenants[1])
  if (a.tenantId === b.tenantId) throw new Error('the two tenants must differ')
  return [a, b]
}

async function resetTenant(t: TenantDescriptor): Promise<void> {
  await withTenantScopeById(t.tenantId, 'script', async () => {
    await db.execute(sql.raw(EFFECTS))
    await db.execute(sql`DELETE FROM gauntlet_eight_effects`)
    await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key LIKE 'eightproof:%'`)
    await db.execute(
      sql`DELETE FROM job_queue WHERE queue IN ('import','export','help-center-translate','workflow-wait','workflow-dispatch','email-imap','segment-evaluation','events')`
    )
  })
}

async function run(): Promise<void> {
  const [a, b] = await pickTenants()
  console.log(`tenants: ${a.tenantId} | ${b.tenantId}`)
  for (const t of [a, b]) await resetTenant(t)

  __setJobDefinitionsForTests(instrumentedDefinitions('unmarked'))
  await startJobTier()
  console.log(
    'job tier started; loops =',
    getJobTierStatus().tenants.map((t) => t.tenantId)
  )

  // Both orderings. One tenant at a time, so a cross-tenant execution has an
  // unambiguous direction rather than being a race between two writers.
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as Array<[TenantDescriptor, TenantDescriptor]>) {
    await withTenantScopeById(first.tenantId, 'script', () => enqueueAllEight(first.tenantId))
    console.log(`enqueued all eight for ${first.tenantId} only (paired with ${second.tenantId})`)
    await new Promise((r) => setTimeout(r, 20_000))
    for (const t of [a, b]) await resetJobRowsIfSecondPass(t, first === b)
  }

  await new Promise((r) => setTimeout(r, 10_000))
  await stopJobTier()

  const effects = new Map<string, EffectRow[]>()
  for (const t of [a, b]) effects.set(t.tenantId, await effectsIn(t.tenantId))

  let crossTenant = 0
  const covered = new Map<string, Set<string>>()
  for (const [owner, rows] of effects) {
    for (const row of rows) {
      const wrongScope = row.scope_tenant_id !== owner
      const wrongOwner = row.enqueued_for !== 'unmarked' && row.enqueued_for !== owner
      if (wrongScope || wrongOwner) {
        crossTenant += 1
        console.log(
          `CROSS-TENANT: row in ${owner}'s database (${row.db_name}, branch ${row.branch_id}) ` +
            `queue=${row.queue} scope=${row.scope_tenant_id} enqueuedFor=${row.enqueued_for}`
        )
      }
      if (!covered.has(owner)) covered.set(owner, new Set())
      covered.get(owner)!.add(row.queue)
    }
  }

  console.log('\nPER-TENANT EXECUTION (the positive control)')
  console.log('queue                   ' + [a, b].map((t) => t.tenantId).join('  '))
  const missing: string[] = []
  for (const queue of EIGHT) {
    const cells = [a, b].map((t) => (covered.get(t.tenantId)?.has(queue) ? 'ran' : 'MISSING'))
    if (cells.includes('MISSING')) missing.push(queue)
    console.log(`${queue.padEnd(24)}${cells.join('   ')}`)
  }
  console.log('')
  for (const [owner, rows] of effects) {
    const branches = new Set(rows.map((r) => r.branch_id ?? 'none'))
    console.log(
      `${owner}: ${rows.length} effect rows, database(s) ` +
        `${[...new Set(rows.map((r) => r.db_name))].join(',')}, branch(es) ${[...branches].join(',')}`
    )
  }

  console.log(`\ncross-tenant observations: ${crossTenant}`)
  if (missing.length > 0) {
    console.log(
      `INCONCLUSIVE — these queues produced no effect in one or both tenants: ${missing.join(', ')}. ` +
        `Zero cross-tenant observations is what a run in which nothing executed also reports.`
    )
    process.exit(3)
  }
  if (crossTenant > 0) {
    console.log('FAIL — a job executed against the wrong tenant’s database.')
    process.exit(1)
  }
  console.log('PASS — all eight executed in both tenants, zero cross-tenant observations.')
}

/** Between the two orderings, clear the first tenant's rows so dedupe keys are free. */
async function resetJobRowsIfSecondPass(t: TenantDescriptor, secondPass: boolean): Promise<void> {
  if (secondPass) return
  await withTenantScopeById(t.tenantId, 'script', async () => {
    await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key LIKE 'eightproof:%'`)
    await db.execute(
      sql`DELETE FROM job_queue WHERE queue IN ('workflow-wait','workflow-dispatch')`
    )
  })
}

async function cleanup(): Promise<void> {
  const [a, b] = await pickTenants()
  for (const t of [a, b]) {
    await withTenantScopeById(t.tenantId, 'script', async () => {
      await db.execute(sql`DROP TABLE IF EXISTS gauntlet_eight_effects`)
      await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key LIKE 'eightproof:%'`)
    })
  }
  console.log('cleaned up')
}

async function main(): Promise<void> {
  if (command === 'cleanup') return cleanup()
  return run()
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

// Referenced so an unused-import lint cannot hide a producer that stopped being
// exercised. `generateId` is the branded-id source the queue itself uses.
void generateId
