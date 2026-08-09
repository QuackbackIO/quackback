/**
 * Evidence harness for the job queue's lease semantics.
 *
 * This exists because the two properties that matter most cannot be shown by a
 * unit test: they are about what happens when a process *dies*, and a test
 * runner that catches the exception has not reproduced a death.
 *
 *   1. A job is held across work far longer than any transaction, with no
 *      transaction open — verified from `pg_stat_activity`, not by assertion.
 *   2. A job declared at-most-once (`maxAttempts: 1`) never runs twice, however
 *      the process is killed. Every stage is killed with SIGKILL.
 *
 * The harness carries its own **positive control**, and that is the part worth
 * reading: the same kill matrix is run against a *retryable* job, where a second
 * execution is expected. If the retryable run does not show a double execution,
 * the harness cannot see a double execution at all, and the at-most-once result
 * it reports means nothing. A run prints both columns side by side for exactly
 * that reason.
 *
 * Side effects are recorded in a scratch table this script creates and drops
 * (`gauntlet_job_effects`); it is not part of the schema.
 *
 * Usage (single-tenant; DATABASE_URL selects the database):
 *
 *   bun run scripts/job-lease-proof.ts kill-matrix
 *   bun run scripts/job-lease-proof.ts long-lease --work-seconds 180
 *   bun run scripts/job-lease-proof.ts wake-latency --samples 20
 *   bun run scripts/job-lease-proof.ts wake-latency --no-listen   (poll fallback)
 *   bun run scripts/job-lease-proof.ts cleanup
 */
import { spawn } from 'node:child_process'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { __setJobDefinitionsForTests } from '@/lib/server/jobs/definitions'
import {
  claimJobs,
  completeJob,
  enqueueJob,
  heartbeatJob,
  reapExpiredLeases,
} from '@/lib/server/jobs/job-queue'
import { drainOnce, runnerConfig, wakeDisabled } from '@/lib/server/jobs/runner'
import { getJobTierStatus, startJobTier, stopJobTier } from '@/lib/server/jobs/tier'

const DSN = process.env.DATABASE_URL ?? ''
if (!DSN) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const args = process.argv.slice(2)
const command = args[0] ?? 'help'
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
/** Stages a job passes through. The child pauses at whichever one is named. */
const STAGES = ['claimed', 'effect-written', 'work-done', 'completed'] as const
type Stage = (typeof STAGES)[number]

function raw(): postgres.Sql {
  return postgres(DSN, { max: 2, onnotice: () => {} })
}

async function ensureEffectsTable(s: postgres.Sql): Promise<void> {
  await s`
    CREATE TABLE IF NOT EXISTS gauntlet_job_effects (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      job_id text NOT NULL,
      queue text NOT NULL,
      pid integer NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    )
  `
}

// ---------------------------------------------------------------------------
// child — claims one job, runs staged work, pauses where told
// ---------------------------------------------------------------------------

async function child(): Promise<void> {
  const queue = flag('queue')!
  const pauseAt = flag('pause-at') as Stage | undefined
  const leaseMs = Number(flag('lease-ms', '4000'))
  const workMs = Number(flag('work-ms', '400'))

  const s = raw()
  const say = (stage: string) => {
    process.stdout.write(`STAGE ${stage}\n`)
  }
  const pause = async (stage: Stage) => {
    say(stage)
    if (pauseAt === stage) {
      // Park forever. The parent SIGKILLs us here, which is a real process
      // death rather than a thrown exception a runner could catch.
      await new Promise(() => {})
    }
  }

  const [job] = await claimJobs({ queues: [queue], limit: 1, leaseMs })
  if (!job) {
    say('nothing-to-claim')
    await s.end()
    return
  }
  await pause('claimed')

  await s`
    INSERT INTO gauntlet_job_effects (job_id, queue, pid)
    VALUES (${job.jobId}, ${queue}, ${process.pid})
  `
  await pause('effect-written')

  const beat = setInterval(() => void heartbeatJob(job, leaseMs).catch(() => {}), leaseMs / 3)
  await new Promise((r) => setTimeout(r, workMs))
  clearInterval(beat)
  await pause('work-done')

  await completeJob(job)
  await pause('completed')

  await s.end()
  process.exit(0)
}

/** Spawn a child and SIGKILL it the moment it reports `pauseAt`. */
function runChildAndKill(opts: {
  queue: string
  pauseAt: Stage
  leaseMs: number
  workMs: number
}): Promise<{ killed: boolean; stages: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      [
        'run',
        __filename,
        'child',
        '--queue',
        opts.queue,
        '--pause-at',
        opts.pauseAt,
        '--lease-ms',
        String(opts.leaseMs),
        '--work-ms',
        String(opts.workMs),
      ],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'inherit'] }
    )
    const stages: string[] = []
    let killed = false
    let buffer = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('STAGE ')) continue
        const stage = line.slice(6)
        stages.push(stage)
        if (stage === opts.pauseAt) {
          killed = true
          proc.kill('SIGKILL')
        }
      }
    })
    proc.on('error', reject)
    proc.on('exit', (code, signal) => {
      if (!killed && code !== 0) {
        reject(new Error(`child exited ${code} ${signal}`))
        return
      }
      resolve({ killed, stages })
    })
  })
}

// ---------------------------------------------------------------------------
// kill-matrix
// ---------------------------------------------------------------------------

interface MatrixRow {
  stage: Stage
  maxAttempts: number
  effectsAfterKill: number
  statusAfterReap: string
  reapVerdict: string
  effectsAfterRecovery: number
  finalStatus: string
  executions: number
}

async function killMatrix(): Promise<void> {
  const s = raw()
  await ensureEffectsTable(s)
  const stamp = Date.now().toString(36)
  const rows: MatrixRow[] = []

  for (const maxAttempts of [1, 3]) {
    for (const stage of STAGES) {
      const queue = `proof-${stamp}-${maxAttempts}-${stage}`
      __setJobDefinitionsForTests([
        {
          name: queue,
          maxAttempts,
          leaseMs: 4_000,
          retryBackoffMs: 0,
          handler: async () => async (job) => {
            // The recovery worker's handler. Identical side effect, so a second
            // execution is indistinguishable from the first except by count.
            await s`
              INSERT INTO gauntlet_job_effects (job_id, queue, pid)
              VALUES (${job.jobId}, ${queue}, ${process.pid})
            `
          },
        },
      ])

      await enqueueJob({ queue, maxAttempts })
      const { killed } = await runChildAndKill({
        queue,
        pauseAt: stage,
        leaseMs: 4_000,
        workMs: 300,
      })
      if (!killed) throw new Error(`child was not killed at ${stage}`)

      const effectsAfterKill = await countEffects(s, queue)

      // Wait out the lease, then let the reaper adjudicate.
      await new Promise((r) => setTimeout(r, 4_500))
      const reaped = await reapExpiredLeases()
      const statusAfterReap = await statusOf(s, queue)

      // A fresh worker drains whatever is left — the boot-after-crash case.
      await drainOnce({ ...runnerConfig(), batchSize: 5 })
      const effectsAfterRecovery = await countEffects(s, queue)

      rows.push({
        stage,
        maxAttempts,
        effectsAfterKill,
        statusAfterReap,
        reapVerdict:
          reaped.terminated > 0 ? 'terminated' : reaped.requeued > 0 ? 'requeued' : 'nothing',
        effectsAfterRecovery,
        finalStatus: await statusOf(s, queue),
        executions: effectsAfterRecovery,
      })
    }
  }

  console.log('')
  console.log('KILL MATRIX — executions of the side effect, by kill point')
  console.log(
    'stage'.padEnd(16) +
      'maxAtt'.padEnd(8) +
      'fx@kill'.padEnd(9) +
      'reap'.padEnd(12) +
      'status'.padEnd(11) +
      'fx@recover'.padEnd(12) +
      'final'
  )
  for (const r of rows) {
    console.log(
      r.stage.padEnd(16) +
        String(r.maxAttempts).padEnd(8) +
        String(r.effectsAfterKill).padEnd(9) +
        r.reapVerdict.padEnd(12) +
        r.statusAfterReap.padEnd(11) +
        String(r.effectsAfterRecovery).padEnd(12) +
        r.finalStatus
    )
  }

  const noRetry = rows.filter((r) => r.maxAttempts === 1)
  const retryable = rows.filter((r) => r.maxAttempts === 3)
  const doubleRuns = noRetry.filter((r) => r.executions > 1)
  const controlDoubles = retryable.filter((r) => r.executions > 1)

  console.log('')
  console.log(
    `at-most-once (maxAttempts=1): max executions = ${Math.max(...noRetry.map((r) => r.executions))}`
  )
  console.log(
    `positive control (maxAttempts=3): stages that DID run twice = ${controlDoubles.length}`
  )

  if (controlDoubles.length === 0) {
    console.log('')
    console.log('CONTROL FAILED — the harness never observed a double execution even where one')
    console.log('was expected, so it cannot detect one. The at-most-once result above is not')
    console.log('evidence of anything.')
    process.exit(3)
  }
  if (doubleRuns.length > 0) {
    console.log('')
    console.log(`FAIL — a no-retry job ran twice at: ${doubleRuns.map((r) => r.stage).join(', ')}`)
    process.exit(1)
  }
  console.log('')
  console.log(
    'PASS — no at-most-once job ran twice, and the control proves a double run is visible.'
  )
  await s.end()
}

async function countEffects(s: postgres.Sql, queue: string): Promise<number> {
  const [{ n }] = await s<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gauntlet_job_effects WHERE queue = ${queue}
  `
  return n
}

async function statusOf(s: postgres.Sql, queue: string): Promise<string> {
  const rows = await s<{ status: string }[]>`
    SELECT status FROM job_queue WHERE queue = ${queue} ORDER BY id LIMIT 1
  `
  return rows[0]?.status ?? 'gone'
}

// ---------------------------------------------------------------------------
// long-lease — hold a job across multi-minute work with no transaction open,
// then kill the process for real and watch the reaper.
// ---------------------------------------------------------------------------

async function longLease(): Promise<void> {
  const workSeconds = Number(flag('work-seconds', '180'))
  const leaseMs = Number(flag('lease-ms', '10000'))
  const queue = `longlease-${Date.now().toString(36)}`
  const s = raw()
  await ensureEffectsTable(s)

  await enqueueJob({ queue, maxAttempts: 1 })
  console.log(`queue=${queue} lease=${leaseMs}ms work=${workSeconds}s maxAttempts=1`)

  const proc = spawn(
    'bun',
    [
      'run',
      __filename,
      'child',
      '--queue',
      queue,
      '--pause-at',
      'never',
      '--lease-ms',
      String(leaseMs),
      '--work-ms',
      String(workSeconds * 1000),
    ],
    { env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit'] }
  )
  console.log(`child pid=${proc.pid}`)

  const started = Date.now()
  let killedAt = 0
  const deadline = started + workSeconds * 1000
  const killAt = started + Math.floor(workSeconds * 1000 * 0.7)

  while (Date.now() < deadline + 60_000) {
    await new Promise((r) => setTimeout(r, 5_000))
    const elapsed = Math.round((Date.now() - started) / 1000)

    const [row] = await s<
      { status: string; locked_until: Date; attempts: number; locked_by: string | null }[]
    >`SELECT status, locked_until, attempts, locked_by FROM job_queue WHERE queue = ${queue}`

    // The evidence that no transaction is being held: the worker's own backend
    // reports idle with no transaction start time, while the job is leased.
    const activity = await s<{ state: string; xact: Date | null; n: number }[]>`
      SELECT state, xact_start AS xact, count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND application_name IS NOT NULL
      GROUP BY state, xact_start
    `
    const inXact = activity.filter((a) => a.xact !== null)
    const leaseIn = row ? Math.round((new Date(row.locked_until).getTime() - Date.now()) / 1000) : 0

    console.log(
      `t+${elapsed}s status=${row?.status} attempts=${row?.attempts} ` +
        `lease_expires_in=${leaseIn}s backends_in_transaction=${inXact.length} ` +
        `holder=${row?.locked_by ?? '-'}`
    )

    if (!killedAt && Date.now() >= killAt) {
      console.log(`--- SIGKILL child pid=${proc.pid} at t+${elapsed}s (mid-work) ---`)
      proc.kill('SIGKILL')
      killedAt = Date.now()
    }

    if (killedAt) {
      const reaped = await reapExpiredLeases()
      if (reaped.terminated > 0 || reaped.requeued > 0) {
        const secs = Math.round((Date.now() - killedAt) / 1000)
        const [after] = await s<{ status: string; last_error: string }[]>`
          SELECT status, last_error FROM job_queue WHERE queue = ${queue}
        `
        console.log('')
        console.log(`REAPED ${secs}s after the process died`)
        console.log(`  requeued=${reaped.requeued} terminated=${reaped.terminated}`)
        console.log(`  status=${after.status}`)
        console.log(`  last_error=${after.last_error}`)
        const fx = await countEffects(s, queue)
        console.log(`  side effects recorded: ${fx}`)
        await s.end()
        return
      }
    }
  }
  console.log('TIMED OUT waiting for the reaper')
  await s.end()
  process.exit(1)
}

// ---------------------------------------------------------------------------
// wake-latency — enqueue, and measure how long until THE TIER runs the job.
//
// The first version of this measured its own `setTimeout`: it resolved on
// `min(NOTIFY, setTimeout(pollMs))`, so the "poll fallback" number it reported
// was the harness's timer rather than the queue's, and it would have printed
// the same figure against a queue that never ran at all. It is the run's
// recurring shape — a measurement that agrees with the hypothesis but could not
// have disagreed.
//
// This version starts the real tier and stops the clock inside the handler, so
// every number includes the doorbell (or its absence), the claim, and dispatch.
// `JOB_WAKE_DISABLED=1` exercises the poll floor through the tier's own code
// path rather than by faking it.
// ---------------------------------------------------------------------------

async function wakeLatency(): Promise<void> {
  const samples = Number(flag('samples', '20'))
  const queue = `wake-${Date.now().toString(36)}`

  let onRun: ((jobId: string) => void) | null = null
  __setJobDefinitionsForTests([
    {
      name: queue,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => async (job) => {
        onRun?.(job.jobId)
      },
    },
  ])

  await startJobTier()
  const status = getJobTierStatus()
  if (!status.running || status.tenants.length === 0) {
    console.log('tier did not start — is QUACKBACK_ROLE=web?')
    process.exit(2)
  }
  console.log(
    `tier running; loops=${status.tenants.length} ` +
      `poll_interval_ms=${runnerConfig().pollIntervalMs} ` +
      `doorbell=${wakeDisabled() ? 'DISABLED (poll only)' : 'enabled'}`
  )
  // Let the loops settle into their wait before the first sample, or the first
  // measurement times a loop that was already mid-pass.
  await new Promise((r) => setTimeout(r, 1_500))

  const latencies: number[] = []
  let missed = 0
  for (let i = 0; i < samples; i++) {
    // Arrive at a uniformly random phase within the poll window. Without this
    // every sample lands just after the previous pass finished, which measures
    // the worst case and reports it as the median — a real workload does not
    // synchronise itself to the poller.
    await new Promise((r) => setTimeout(r, Math.random() * runnerConfig().pollIntervalMs))

    const ran = new Promise<number | null>((resolve) => {
      const t0 = Date.now()
      let settled = false
      onRun = (jobId) => {
        if (settled || jobId !== expected.jobId) return
        settled = true
        clearTimeout(timer)
        resolve(Date.now() - t0)
      }
      // A generous ceiling: this is the "the tier never ran it" case, which is
      // what a dead doorbell AND a dead poll looks like. It must be reported as
      // a miss, not folded into the distribution.
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(null)
      }, 10_000)
      timer.unref?.()
    })
    const expected = await enqueueJob({ queue, dedupeKey: `s-${i}` })
    const took = await ran
    if (took === null) missed += 1
    else latencies.push(took)
  }
  onRun = null
  await stopJobTier()

  latencies.sort((a, b) => a - b)
  const p = (q: number) =>
    latencies.length === 0
      ? NaN
      : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
  console.log('')
  console.log(
    `ran=${latencies.length}/${samples}  missed=${missed}  ` +
      (latencies.length
        ? `min=${latencies[0]}ms  p50=${p(0.5)}ms  p95=${p(0.95)}ms  max=${latencies[latencies.length - 1]}ms`
        : 'NO JOB WAS EVER RUN')
  )
  if (latencies.length) console.log(`samples: ${latencies.join(', ')}`)

  const left = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM job_queue WHERE queue = ${queue} GROUP BY status
  `)
  console.log(
    'rows left behind: ' +
      getExecuteRows<{ status: string; n: number }>(left)
        .map((r) => `${r.status}=${r.n}`)
        .join(' ') || 'none'
  )
  await db.execute(sql`DELETE FROM job_queue WHERE queue = ${queue}`)
}

// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  const s = raw()
  await s`DROP TABLE IF EXISTS gauntlet_job_effects`
  const res = await db.execute(sql`
    DELETE FROM job_queue
    WHERE queue LIKE 'proof-%' OR queue LIKE 'longlease-%' OR queue LIKE 'wake-%'
    RETURNING id
  `)
  console.log(`removed ${getExecuteRows(res).length} proof rows and the effects table`)
  await s.end()
}

async function main(): Promise<void> {
  switch (command) {
    case 'child':
      return child()
    case 'kill-matrix':
      return killMatrix()
    case 'long-lease':
      return longLease()
    case 'wake-latency':
      return wakeLatency()
    case 'cleanup':
      return cleanup()
    default:
      console.log('commands: kill-matrix | long-lease | wake-latency | cleanup | child')
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
