/**
 * Evidence harness for the queue's workspace boundary, run against a real pooled
 * fleet (`QUACKBACK_TENANCY=pooled`, a real control-plane registry, one
 * database per workspace).
 *
 * The queue is per-workspace by construction — the table lives in the workspace's own
 * database, so there is no shared queue to route out of. That is a structural
 * argument, and SAAS-HOSTING-STACK.md §3 is precisely the observation that a
 * wrong-workspace answer passes every structural check without erroring. So this
 * harness does not argue; it measures, in both directions.
 *
 * What each executed job records, into a scratch table in **whatever database
 * `db` actually resolved to**:
 *
 *   - the workspace id the scope claimed  (`getCurrentWorkspace()`)
 *   - `current_database()` of the database written to
 *
 * A cross-workspace execution is then observable two independent ways, and neither
 * requires trusting the other:
 *
 *   1. an effect row appears in a workspace's database for a job enqueued into a
 *      different workspace's database; or
 *   2. an effect row's recorded scope id does not match the workspace that owns
 *      the database the row is sitting in.
 *
 * Both orderings are run. A cache or a pool that is last-writer-wins is
 * asymmetric, and testing one direction leaves detection to whichever workspace's
 * value happened to survive.
 *
 * Usage:
 *   env $(cat pooled.env) bun run scripts/job-workspace-proof.ts run
 *   env ... bun run scripts/job-workspace-proof.ts listen-endpoints   (§7.3 re-check)
 *   env ... bun run scripts/job-workspace-proof.ts cleanup
 */
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { listActiveWorkspaces, type WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import { resolveWorkspacePassword } from '@/lib/server/workspaces/pool-cache'
import { withWorkspaceScopeById } from '@/lib/server/workspaces/fleet'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
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
  CREATE TABLE IF NOT EXISTS gauntlet_workspace_effects (
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
      FROM gauntlet_workspace_effects ORDER BY id
    `)
    return getExecuteRows<EffectRow>(res)
  })
}

async function run(): Promise<void> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) console.log('refused registry records:', refused)
  if (workspaces.length < 2) {
    console.error(`need at least two active workspaces, found ${workspaces.length}`)
    process.exit(2)
  }
  const wantA = flag('a')
  const wantB = flag('b')
  const pick = (id: string | undefined, fallback: WorkspaceDescriptor): WorkspaceDescriptor => {
    if (!id) return fallback
    const found = workspaces.find((t) => t.workspaceKey === id)
    if (!found) throw new Error(`workspace ${id} is not active in the registry`)
    return found
  }
  const a = pick(wantA, workspaces[0])
  const b = pick(wantB, workspaces[1])
  if (a.workspaceKey === b.workspaceKey) throw new Error('the two workspaces must differ')
  console.log(
    `workspaces: ${a.workspaceKey} (${a.database.directUrl}) | ${b.workspaceKey} (${b.database.directUrl})`
  )

  for (const t of [a, b]) {
    await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
      await db.execute(sql.raw(EFFECTS))
      await db.execute(sql`DELETE FROM gauntlet_workspace_effects`)
      await db.execute(sql`DELETE FROM job_queue WHERE queue LIKE 'workspaceproof-%'`)
    })
  }

  const stamp = Date.now().toString(36)
  const queue = `workspaceproof-${stamp}`

  __setJobDefinitionsForTests([
    {
      name: queue,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        const scope = getCurrentWorkspace()?.workspaceKey ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_workspace_effects
            (job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue},
                 ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? '?')},
                 ${scope}, current_database(), current_database()
        `)
      },
    },
  ])

  await startJobTier()
  console.log(
    'job tier started; loops =',
    getJobTierStatus().workspaces.map((t) => t.workspaceKey)
  )

  // ---- both orderings, one workspace at a time -------------------------------
  const enqueued: Array<{ workspaceKey: string; jobId: string }> = []
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as Array<[WorkspaceDescriptor, WorkspaceDescriptor]>) {
    const res = await withWorkspaceScopeById(first.workspaceKey, 'script', () =>
      enqueueJob({
        queue,
        payload: { enqueuedFor: first.workspaceKey },
        maxAttempts: 1,
        dedupeKey: `${first.workspaceKey}-${second.workspaceKey}`,
      })
    )
    enqueued.push({ workspaceKey: first.workspaceKey, jobId: res.jobId })
    console.log(`enqueued ${res.jobId} for ${first.workspaceKey} only`)
    await new Promise((r) => setTimeout(r, 4_000))
  }

  // ---- the wrong-workspace row: planted, must never execute ------------------
  const plantedQueue = `${queue}-planted`
  __setJobDefinitionsForTests([
    ...[
      {
        name: queue,
        maxAttempts: 1,
        leaseMs: 30_000,
        handler: async () => async (job: { jobId: string; queue: string; payload: unknown }) => {
          const scope = getCurrentWorkspace()?.workspaceKey ?? null
          await db.execute(sql`
            INSERT INTO gauntlet_workspace_effects
              (job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id)
            SELECT ${job.jobId}, ${job.queue},
                   ${String((job.payload as { enqueuedFor?: string }).enqueuedFor ?? '?')},
                   ${scope}, current_database(), current_database()
          `)
        },
      },
    ],
    {
      name: plantedQueue,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        const scope = getCurrentWorkspace()?.workspaceKey ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_workspace_effects
            (job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue}, 'PLANTED', ${scope},
                 current_database(), current_database()
        `)
      },
    },
  ])

  await withWorkspaceScopeById(a.workspaceKey, 'script', async () => {
    // ONE write, already carrying the foreign stamp. The earlier version
    // enqueued and then restamped, which is a race the doorbell wins about a
    // third of the time: the tier wakes on the insert and can run the job while
    // it is still correctly stamped, so the run reports a pass without ever
    // presenting the tier with a wrong-workspace row. The instrument was a coin
    // flip. The row must never exist in a runnable, correctly-stamped state.
    await db.execute(sql`
      INSERT INTO job_queue (job_id, queue, dedupe_key, workspace_key, payload, max_attempts)
      VALUES (${generateId('job')}, ${plantedQueue}, 'planted', ${b.workspaceKey}, '{}'::jsonb, 1)
    `)
  })
  console.log(`planted a row in ${a.workspaceKey}'s queue stamped for ${b.workspaceKey}`)
  await new Promise((r) => setTimeout(r, 6_000))

  // ---- the cron path: every workspace must receive every slot ----------------
  // Both earlier harnesses used cron-less definitions, so neither could see a
  // scheduler that hands each slot to one workspace and starves the rest.
  const cronQueue = `${queue}-cron`
  await stopJobTier()
  __setJobDefinitionsForTests([
    {
      name: cronQueue,
      cron: '* * * * *',
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        const scope = getCurrentWorkspace()?.workspaceKey ?? null
        await db.execute(sql`
          INSERT INTO gauntlet_workspace_effects
            (job_id, queue, enqueued_for, scope_workspace_key, db_name, branch_id)
          SELECT ${job.jobId}, ${job.queue},
                 ${String((job.payload as { scheduledFor?: string }).scheduledFor ?? 'CRON')},
                 ${scope}, current_database(), current_database()
        `)
      },
    },
  ])
  await startJobTier()
  console.log('watching a per-minute schedule across both workspaces for 150s...')
  await new Promise((r) => setTimeout(r, 150_000))
  await stopJobTier()

  const slotsBy = new Map<string, string[]>()
  for (const t of [a, b]) {
    const rows = await effectsIn(t.workspaceKey)
    slotsBy.set(
      t.workspaceKey,
      rows
        .filter((r) => r.queue === cronQueue)
        .map((r) => r.enqueued_for)
        .sort()
    )
  }
  const aSlots = slotsBy.get(a.workspaceKey)!
  const bSlots = slotsBy.get(b.workspaceKey)!
  const onlyA = aSlots.filter((x) => !bSlots.includes(x))
  const onlyB = bSlots.filter((x) => !aSlots.includes(x))
  console.log('')
  console.log(`${a.workspaceKey} cron slots (${aSlots.length}): ${aSlots.join('  ')}`)
  console.log(`${b.workspaceKey} cron slots (${bSlots.length}): ${bSlots.join('  ')}`)
  console.log(`only A: ${onlyA.join('  ') || '(none)'}`)
  console.log(`only B: ${onlyB.join('  ') || '(none)'}`)
  const cronStarved = onlyA.length > 0 || onlyB.length > 0 || aSlots.length === 0

  // ---- verdict ------------------------------------------------------------
  let crossWorkspace = 0
  const owner = new Map<string, string>()
  for (const t of [a, b]) owner.set(t.workspaceKey, t.workspaceKey)

  console.log('')
  for (const t of [a, b]) {
    const rows = (await effectsIn(t.workspaceKey)).filter((r) => r.queue !== cronQueue)
    console.log(`--- effects recorded IN ${t.workspaceKey} (${rows.length}) ---`)
    for (const r of rows) {
      const enqueuedElsewhere = r.enqueued_for !== t.workspaceKey
      const scopeMismatch = r.scope_workspace_key !== t.workspaceKey
      const bad = enqueuedElsewhere || scopeMismatch
      if (bad) crossWorkspace += 1
      console.log(
        `  job=${r.job_id} queue=${r.queue} enqueued_for=${r.enqueued_for} ` +
          `scope=${r.scope_workspace_key} db=${r.db_name} branch=${r.branch_id} ` +
          `${bad ? '  <-- CROSS-WORKSPACE' : ''}`
      )
    }
  }

  // The planted row's fate.
  const planted = await withWorkspaceScopeById(a.workspaceKey, 'script', async () => {
    const res = await db.execute(sql`
      SELECT status, last_error, attempts FROM job_queue WHERE queue = ${plantedQueue}
    `)
    return getExecuteRows<{ status: string; last_error: string; attempts: number }>(res)[0]
  })
  console.log('')
  console.log(`planted row: status=${planted?.status} attempts=${planted?.attempts}`)
  console.log(`             last_error=${planted?.last_error}`)

  const plantedRan = (await effectsIn(a.workspaceKey)).some((r) => r.queue === plantedQueue)
  const plantedRanB = (await effectsIn(b.workspaceKey)).some((r) => r.queue === plantedQueue)

  console.log('')
  console.log(`cross-workspace observations: ${crossWorkspace}`)
  console.log(`planted wrong-workspace job executed anywhere: ${plantedRan || plantedRanB}`)

  // Positive control: the harness has to be able to SEE an effect at all. Two
  // executions were expected, one per workspace, each in its own database.
  const nonCron = (id: string) =>
    effectsIn(id).then((rs) => rs.filter((r) => r.queue !== cronQueue))
  const total = (await nonCron(a.workspaceKey)).length + (await nonCron(b.workspaceKey)).length
  const legit = total - (plantedRan || plantedRanB ? 1 : 0)
  console.log(`legitimate executions observed: ${legit} (expected 2 — one per workspace)`)
  if (legit !== 2) {
    console.log('')
    console.log('CONTROL FAILED — the expected per-workspace executions were not observed, so a')
    console.log('"zero cross-workspace" result here would be a result from a surface that ran')
    console.log('nothing. Fix the fixture before reading the verdict.')
    process.exit(3)
  }
  if (cronStarved) {
    console.log('')
    console.log('FAIL — a scheduled slot did not reach every workspace. Scheduler state is shared.')
    process.exit(1)
  }
  if (crossWorkspace > 0 || plantedRan || plantedRanB) {
    console.log('FAIL')
    process.exit(1)
  }
  console.log('PASS — every job executed against exactly its own workspace database,')
  console.log('       and every scheduled slot reached both workspaces.')
}

/**
 * The §7.3 re-check, for this queue's own channel: does `LISTEN` on the queue
 * wake channel actually deliver through the pooled endpoint?
 *
 * Measured by sending a NOTIFY and waiting for it. Never by asking
 * `pg_listening_channels()`, which reports the registration as present on a
 * pooled connection that delivers nothing.
 */
async function listenEndpoints(): Promise<void> {
  const { workspaces } = await listActiveWorkspaces()
  const only = (flag('only') ?? '').split(',').filter(Boolean)
  for (const t of workspaces) {
    if (only.length > 0 && !only.includes(t.workspaceKey)) continue
    for (const [label, url] of [
      ['direct', t.database.directUrl],
      ['pooled', t.database.pooledUrl],
    ] as const) {
      let delivered: boolean
      try {
        const listener = await openWakeListener({
          directUrl: url,
          password: () => resolveWorkspacePassword(t),
          label: `${t.workspaceKey}:${label}`,
          onWake: () => {},
        })
        delivered = await listener.verify(6_000)
        await listener.close()
      } catch (err) {
        console.log(`${t.workspaceKey} ${label}: ERROR ${(err as Error).message}`)
        continue
      }

      // The false-green instrument, reported alongside so the difference is on
      // the record rather than in a footnote.
      const pw = await resolveWorkspacePassword(t)
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
        `${t.workspaceKey.padEnd(24)} ${label.padEnd(7)} ` +
          `notify_delivered=${String(delivered).padEnd(6)} pg_listening_channels_says=${catalogueSays}`
      )
    }
  }
}

async function cleanup(): Promise<void> {
  const { workspaces } = await listActiveWorkspaces()
  for (const t of workspaces) {
    await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
      await db.execute(sql`DROP TABLE IF EXISTS gauntlet_workspace_effects`)
      await db.execute(sql`DELETE FROM job_queue WHERE queue LIKE 'workspaceproof-%'`)
    })
    console.log(`cleaned ${t.workspaceKey}`)
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
