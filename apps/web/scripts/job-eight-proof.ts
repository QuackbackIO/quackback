/**
 * The eight migrated queues, on a real two-workspace pooled fleet.
 *
 * `job-workspace-proof.ts` established the boundary with a synthetic queue. This
 * one runs the **real registry** — every definition's real name, concurrency,
 * `maxAttempts`, lease and backoff — and enqueues through each queue's **real
 * producer function**, so what is exercised is the code the app calls.
 *
 * Every handler is wrapped rather than replaced: the wrapper records
 * `getCurrentWorkspace()` and `current_database()` into a
 * scratch table **in whichever database `db` actually resolved to**, and then
 * calls the real handler. A cross-workspace execution is observable two
 * independent ways, neither needing the other to be trusted:
 *
 *   1. an effect row appears in a workspace's database for a job enqueued into a
 *      different workspace's database; or
 *   2. an effect row's recorded scope does not match the workspace that owns the
 *      database the row is sitting in.
 *
 * Both orderings are run, because a last-writer-wins cache is asymmetric and
 * testing one direction leaves detection to whichever workspace happened to write
 * second.
 *
 * **The positive control matters as much as the verdict.** "Zero cross-workspace
 * observations" is also what a run in which nothing executed would report, so
 * the run fails unless every one of the eight produced an effect in *both*
 * workspaces. If the control does not fire, that is the signal to look at.
 *
 * Usage:
 *   env $(cat pooled.env) bun run scripts/job-eight-proof.ts run --a <id> --b <id>
 *   env $(cat pooled.env) bun run scripts/job-eight-proof.ts cleanup
 */
import { sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { listActiveWorkspaces, type WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import { withWorkspaceScopeById } from '@/lib/server/workspaces/fleet'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
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
    scope_workspace_key text,
    db_name text NOT NULL,
    branch_id text,
    at timestamptz NOT NULL DEFAULT now()
  )
`

interface EffectRow {
  job_id: string
  queue: string
  enqueued_for: string
  scope_workspace_key: string | null
  db_name: string
  branch_id: string | null
}

async function effectsIn(workspaceKey: string): Promise<EffectRow[]> {
  return withWorkspaceScopeById(workspaceKey, 'script', async () => {
    const res = await db.execute(sql`
      SELECT job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id
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
        const scope = getCurrentWorkspace()?.workspaceKey ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_eight_effects
            (job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue},
                 ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? marker)},
                 ${scope}, current_database(), current_database()
        `)
        // Then the real handler. Most of these have no fixture in a bare workspace
        // database and will throw; the row above is written first precisely so
        // the boundary is observable regardless of the domain outcome.
        await real(job)
      }
    },
  }))
}

function probeEvent(workspaceKey: string): EventData {
  return {
    id: `evt-eightproof-${workspaceKey}-${Date.now()}`,
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
async function enqueueAllEight(workspaceKey: string): Promise<void> {
  const tag = { enqueuedFor: workspaceKey }
  await enqueueHookJobsWithIds([
    {
      name: 'post.created:__post_merge_recheck__',
      // A sentinel hook with no post id: the handler returns immediately, so
      // this exercises the real dispatch path without a fixture.
      data: {
        hookType: '__post_merge_recheck__',
        event: probeEvent(workspaceKey),
        target: null,
        config: {},
        ...tag,
      },
      jobId: `eightproof:${workspaceKey}:events`,
    },
  ])
  await enqueueJob({
    queue: 'segment-evaluation',
    payload: { segmentId: 'segment_eightproof_missing', ...tag },
    dedupeKey: `eightproof:${workspaceKey}:segment`,
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
    dedupeKey: `eightproof:${workspaceKey}:imap`,
    maxAttempts: 1,
  })
  await enqueueWorkflowDispatch({ ...probeEvent(workspaceKey), ...tag } as never)
  await scheduleWorkflowResume(`wfr_eightproof_${workspaceKey}`, 0, 1)
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

async function pickWorkspaces(): Promise<[WorkspaceDescriptor, WorkspaceDescriptor]> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) console.log('refused registry records:', refused)
  const pick = (id: string | undefined, fallback: WorkspaceDescriptor): WorkspaceDescriptor => {
    if (!id) return fallback
    const found = workspaces.find((t) => t.workspaceKey === id)
    if (!found) throw new Error(`workspace ${id} is not active in the registry`)
    return found
  }
  const a = pick(flag('a'), workspaces[0])
  const b = pick(flag('b'), workspaces[1])
  if (a.workspaceKey === b.workspaceKey) throw new Error('the two workspaces must differ')
  return [a, b]
}

async function resetWorkspace(t: WorkspaceDescriptor): Promise<void> {
  await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
    await db.execute(sql.raw(EFFECTS))
    await db.execute(sql`DELETE FROM gauntlet_eight_effects`)
    await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key LIKE 'eightproof:%'`)
    await db.execute(
      sql`DELETE FROM job_queue WHERE queue IN ('import','export','help-center-translate','workflow-wait','workflow-dispatch','email-imap','segment-evaluation','events')`
    )
  })
}

async function run(): Promise<void> {
  const [a, b] = await pickWorkspaces()
  console.log(`workspaces: ${a.workspaceKey} | ${b.workspaceKey}`)
  for (const t of [a, b]) await resetWorkspace(t)

  __setJobDefinitionsForTests(instrumentedDefinitions('unmarked'))
  await startJobTier()
  console.log(
    'job tier started; loops =',
    getJobTierStatus().workspaces.map((t) => t.workspaceKey)
  )

  // Both orderings. One workspace at a time, so a cross-workspace execution has an
  // unambiguous direction rather than being a race between two writers.
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as Array<[WorkspaceDescriptor, WorkspaceDescriptor]>) {
    await withWorkspaceScopeById(first.workspaceKey, 'script', () =>
      enqueueAllEight(first.workspaceKey)
    )
    console.log(
      `enqueued all eight for ${first.workspaceKey} only (paired with ${second.workspaceKey})`
    )
    await new Promise((r) => setTimeout(r, 20_000))
    for (const t of [a, b]) await resetJobRowsIfSecondPass(t, first === b)
  }

  await new Promise((r) => setTimeout(r, 10_000))
  await stopJobTier()

  const effects = new Map<string, EffectRow[]>()
  for (const t of [a, b]) effects.set(t.workspaceKey, await effectsIn(t.workspaceKey))

  let crossWorkspace = 0
  const covered = new Map<string, Set<string>>()
  for (const [owner, rows] of effects) {
    for (const row of rows) {
      const wrongScope = row.scope_workspace_key !== owner
      const wrongOwner = row.enqueued_for !== 'unmarked' && row.enqueued_for !== owner
      if (wrongScope || wrongOwner) {
        crossWorkspace += 1
        console.log(
          `CROSS-WORKSPACE: row in ${owner}'s database (${row.db_name}, branch ${row.branch_id}) ` +
            `queue=${row.queue} scope=${row.scope_workspace_key} enqueuedFor=${row.enqueued_for}`
        )
      }
      if (!covered.has(owner)) covered.set(owner, new Set())
      covered.get(owner)!.add(row.queue)
    }
  }

  console.log('\nPER-WORKSPACE EXECUTION (the positive control)')
  console.log('queue                   ' + [a, b].map((t) => t.workspaceKey).join('  '))
  const missing: string[] = []
  for (const queue of EIGHT) {
    const cells = [a, b].map((t) => (covered.get(t.workspaceKey)?.has(queue) ? 'ran' : 'MISSING'))
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

  console.log(`\ncross-workspace observations: ${crossWorkspace}`)
  if (missing.length > 0) {
    console.log(
      `INCONCLUSIVE — these queues produced no effect in one or both workspaces: ${missing.join(', ')}. ` +
        `Zero cross-workspace observations is what a run in which nothing executed also reports.`
    )
    process.exit(3)
  }
  if (crossWorkspace > 0) {
    console.log('FAIL — a job executed against the wrong workspace’s database.')
    process.exit(1)
  }
  console.log('PASS — all eight executed in both workspaces, zero cross-workspace observations.')
}

/** Between the two orderings, clear the first workspace's rows so dedupe keys are free. */
async function resetJobRowsIfSecondPass(
  t: WorkspaceDescriptor,
  secondPass: boolean
): Promise<void> {
  if (secondPass) return
  await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
    await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key LIKE 'eightproof:%'`)
    await db.execute(
      sql`DELETE FROM job_queue WHERE queue IN ('workflow-wait','workflow-dispatch')`
    )
  })
}

async function cleanup(): Promise<void> {
  const [a, b] = await pickWorkspaces()
  for (const t of [a, b]) {
    await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
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
