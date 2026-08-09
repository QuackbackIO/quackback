/**
 * What the serial drain cost, measured rather than argued.
 *
 * `JOBS.md` §10 handed this piece a question: the first cohort drained one
 * batch to completion before ticking the schedule again, and slots that elapse
 * inside a long job are **dropped, not delayed** — `latestSlotAtOrBefore`
 * returns only the slot bracketing now, so the intervening ones are never
 * enqueued at all. Negligible while every sweep was sub-second; not negligible
 * with a 120-second lease arriving on the same loop.
 *
 * This harness runs the shipped loop twice against a real Postgres, with one
 * queue holding a long job while a per-minute schedule ticks alongside it:
 *
 *   pool    the shipped shape — `dispatchPass` starts the work and returns
 *   serial  the same code with the pool awaited before the loop continues,
 *           which is exactly what `drainOnce` did
 *
 * The serial run is the **control**. If it does not lose slots, this harness
 * cannot see a lost slot, and the pool run's clean result means nothing — so a
 * run refuses to report a result unless the control fires.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/job-concurrency-proof.ts --work-seconds 130
 */
import postgres from 'postgres'
import { __setJobDefinitionsForTests, type JobDefinition } from '@/lib/server/jobs/definitions'
import {
  awaitPool,
  createJobPool,
  createScheduleState,
  dispatchPass,
  runJob,
  runScheduleTick,
  runnerConfig,
} from '@/lib/server/jobs/runner'
import { enqueueJob } from '@/lib/server/jobs/job-queue'

const DSN = process.env.DATABASE_URL ?? ''
if (!DSN) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : fallback
}

const WORK_SECONDS = arg('work-seconds', 130)
/** How long each mode runs. Long enough to cross the work and see slots after. */
const OBSERVE_SECONDS = arg('observe-seconds', WORK_SECONDS + 60)

const sql = postgres(DSN, { max: 4, onnotice: () => {} })
const stamp = `${process.pid}-${Date.now().toString(36)}`

interface ModeResult {
  mode: 'pool' | 'serial'
  slowRuns: number
  slotsEnqueued: number
  slotsDue: number
}

async function runMode(mode: 'pool' | 'serial'): Promise<ModeResult> {
  const slow = `conc-${stamp}-${mode}-slow`
  const fast = `conc-${stamp}-${mode}-fast`
  let slowRuns = 0

  const defs: JobDefinition[] = [
    {
      name: slow,
      concurrency: 1,
      maxAttempts: 1,
      // The real `help-center-translate` lease. The point of the lease is that
      // the work outlives any transaction, so the handler genuinely sleeps.
      leaseMs: 120_000,
      handler: async () => async () => {
        slowRuns += 1
        await new Promise((r) => setTimeout(r, WORK_SECONDS * 1000))
      },
    },
    {
      name: fast,
      // The cadence `snooze-sweep` and `sla-breach-sweep` run on.
      cron: '* * * * *',
      concurrency: 1,
      maxAttempts: 1,
      handler: async () => async () => {},
    },
  ]
  __setJobDefinitionsForTests(defs)

  const config = { ...runnerConfig(), pollIntervalMs: 250 }
  const pool = createJobPool()
  const schedule = createScheduleState()

  // Seed the scheduler's memory the way the tier's first pass does (adopt the
  // current slot without running it), then start the long job.
  await runScheduleTick(schedule, new Date())
  await enqueueJob({ queue: slow, maxAttempts: 1 })

  const startedAt = Date.now()
  const deadline = startedAt + OBSERVE_SECONDS * 1000
  while (Date.now() < deadline) {
    await runScheduleTick(schedule, new Date())
    await dispatchPass({ pool, config, run: runJob })
    if (mode === 'serial') {
      // The first cohort's shape: the loop does not come back round until the
      // batch it claimed has finished.
      await awaitPool(pool)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  await awaitPool(pool)

  const rows = (await sql`
    SELECT count(*)::int AS n FROM job_queue WHERE queue = ${fast}
  `) as unknown as Array<{ n: number }>

  // How many per-minute slots actually elapsed during the observation window.
  const slotsDue = Math.floor(
    (Math.floor(deadline / 60_000) * 60_000 - Math.floor(startedAt / 60_000) * 60_000) / 60_000
  )

  await sql`DELETE FROM job_queue WHERE queue IN (${slow}, ${fast})`
  __setJobDefinitionsForTests(null)
  return { mode, slowRuns, slotsEnqueued: rows[0].n, slotsDue }
}

async function main(): Promise<void> {
  console.log(
    `one ${WORK_SECONDS}s job on one queue, a per-minute schedule on another, ` +
      `${OBSERVE_SECONDS}s per mode\n`
  )
  const serial = await runMode('serial')
  const pooled = await runMode('pool')

  console.log('\nSLOTS ENQUEUED WHILE ONE QUEUE HELD A LONG JOB')
  console.log('drain shape  slow runs  per-minute slots enqueued  slots due')
  for (const r of [serial, pooled]) {
    console.log(
      `${r.mode.padEnd(12)} ${String(r.slowRuns).padEnd(10)} ` +
        `${String(r.slotsEnqueued).padEnd(26)} ${r.slotsDue}`
    )
  }

  const controlFired = serial.slotsEnqueued < serial.slotsDue
  const poolClean = pooled.slotsEnqueued >= pooled.slotsDue

  console.log('')
  if (!controlFired) {
    console.log(
      'INCONCLUSIVE — the serial control did not lose a slot, so this harness cannot ' +
        'see a lost slot. Look at the control, not at the pooled column.'
    )
    await sql.end()
    process.exit(3)
  }
  if (!poolClean) {
    console.log(
      `FAIL — the bounded pool lost ${pooled.slotsDue - pooled.slotsEnqueued} of ` +
        `${pooled.slotsDue} slots; the serial drain's defect survives.`
    )
    await sql.end()
    process.exit(1)
  }
  console.log(
    `PASS — serial lost ${serial.slotsDue - serial.slotsEnqueued} of ${serial.slotsDue} slots ` +
      `(the control), the bounded pool lost none.`
  )
  await sql.end()
}

void main().catch(async (err) => {
  console.error(err)
  await sql.end().catch(() => {})
  process.exit(1)
})
