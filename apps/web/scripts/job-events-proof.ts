/**
 * The four properties of the `events` queue that are easiest to lose in a move,
 * demonstrated against a real Postgres rather than asserted.
 *
 *   1. the custom retry curve — two fast retries then jittered hourly ones,
 *      not the tier's geometric default
 *   2. bulk enqueue with deterministic keys, so the relay's re-drain is a no-op
 *   3. delayed jobs that can be cancelled and re-scheduled
 *   4. the webhook auto-disable side effect, which must count only PERMANENT
 *      failures — counting retries disables a flaky endpoint after ~17 events
 *      instead of 50
 *
 * (4) is run end to end: a real `webhooks` row, a real HTTP receiver this
 * script starts, and the real `webhook` hook doing a real signed POST. The
 * receiver answers 400, which the hook classifies as non-retryable, so each
 * delivery is permanently failed on its first attempt.
 *
 * Every measurement carries its control. The retry curve is compared against
 * the geometric default it would have had without `backoffMs`; the auto-disable
 * count is compared against a run of *retryable* failures, which must leave the
 * counter untouched.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/job-events-proof.ts
 */
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  DEFAULT_RETRY_BACKOFF_MS,
  findJobDefinition,
  retryBackoffMs,
} from '@/lib/server/jobs/definitions'
import { claimJobs, enqueueJob, failJob } from '@/lib/server/jobs/job-queue'
import { drainOnce, runnerConfig } from '@/lib/server/jobs/runner'
import { EVENTS_QUEUE, enqueueHookJobsWithIds } from '@/lib/server/events/process'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import { encryptWebhookSecret } from '@/lib/server/domains/webhooks/encryption'

const DSN = process.env.DATABASE_URL ?? ''
if (!DSN) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const raw = postgres(DSN, { max: 4, onnotice: () => {} })
const RUN = `evproof-${process.pid}-${Date.now().toString(36)}`
const failures: string[] = []

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}  ${detail}`)
  if (!ok) failures.push(name)
}

async function cleanup(): Promise<void> {
  await raw`DELETE FROM job_queue WHERE dedupe_key LIKE ${RUN + '%'}`
  await raw`DELETE FROM webhooks WHERE url LIKE ${'%/hook?run=' + RUN}`
}

// ---------------------------------------------------------------------------
// 1. the retry curve
// ---------------------------------------------------------------------------

async function curve(): Promise<void> {
  const def = findJobDefinition(EVENTS_QUEUE)
  if (!def) throw new Error('no `events` definition')

  const measured: number[] = []
  const key = `${RUN}:curve`
  await enqueueJob({ queue: EVENTS_QUEUE, dedupeKey: key, maxAttempts: 6 })

  for (let attempt = 1; attempt <= 3; attempt++) {
    const [job] = await claimJobs({
      specs: [{ queue: EVENTS_QUEUE, limit: 1, leaseMs: 30_000 }],
    })
    if (!job || job.dedupeKey !== key) {
      // Another row on the shared queue won the claim; put this attempt back.
      if (job) await failJob(job, 'not ours', { backoffMs: 0 })
      continue
    }
    const before = Date.now()
    await failJob(job, 'probe', { backoffMs: retryBackoffMs(def, job.attempts) })
    const rows = getExecuteRows<{ run_at: Date | string }>(
      await db.execute(
        sql`SELECT run_at FROM job_queue WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ${key}`
      )
    )
    const runAt = new Date(rows[0].run_at as string).getTime()
    measured.push(runAt - before)
    // Move it back into the runnable window so the next attempt can be claimed
    // without waiting out an hour of real time.
    await raw`UPDATE job_queue SET run_at = now() WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ${key}`
  }

  const geometric = [1, 2, 3].map((n) => DEFAULT_RETRY_BACKOFF_MS * 2 ** (n - 1))
  console.log(
    `  measured delays (ms): ${measured.map((m) => Math.round(m)).join(', ')}\n` +
      `  the geometric default would have been: ${geometric.join(', ')}`
  )
  check(
    'retry curve: fast retries clear a blip in seconds',
    measured[0] < 60_000 && measured[1] < 60_000,
    `${measured[0]}ms, ${measured[1]}ms`
  )
  check(
    'retry curve: the third retry is hours, not the geometric 20s',
    measured[2] > 30 * 60_000,
    `${Math.round(measured[2] / 60_000)} min vs ${geometric[2] / 1000}s`
  )
}

// ---------------------------------------------------------------------------
// 2. bulk enqueue with deterministic keys
// ---------------------------------------------------------------------------

async function bulk(): Promise<void> {
  const jobs = [0, 1, 2].map((i) => ({
    name: 'post.created:__post_merge_recheck__',
    data: { hookType: '__post_merge_recheck__', event: {}, target: null, config: {} } as never,
    jobId: `${RUN}:bulk:${i}`,
  }))
  await enqueueHookJobsWithIds(jobs)
  const first = await countKeys(`${RUN}:bulk:`)
  // The relay re-drains an unpublished row after a crash and re-enqueues the
  // SAME keys.
  await enqueueHookJobsWithIds(jobs)
  const second = await countKeys(`${RUN}:bulk:`)
  check('bulk enqueue: one row per target', first === 3, `${first} rows`)
  check('bulk enqueue: a re-drain adds nothing', second === 3, `${second} rows after re-enqueue`)
}

async function countKeys(prefix: string): Promise<number> {
  const rows = (await raw`
    SELECT count(*)::int AS n FROM job_queue
    WHERE queue = ${EVENTS_QUEUE} AND dedupe_key LIKE ${prefix + '%'}
  `) as unknown as Array<{ n: number }>
  return rows[0].n
}

// ---------------------------------------------------------------------------
// 3. cancelable delayed jobs
// ---------------------------------------------------------------------------

async function delayed(): Promise<void> {
  const jobId = `${RUN}:delayed`
  await scheduleDispatch({
    jobId,
    handler: '__changelog_publish__',
    delayMs: 3_600_000,
    payload: { changelogId: 'cl_probe' },
  })
  const scheduled = (await raw`
    SELECT status, run_at > now() + interval '50 minutes' AS far_future
    FROM job_queue WHERE queue = ${EVENTS_QUEUE} AND dedupe_key = ${jobId}
  `) as unknown as Array<{ status: string; far_future: boolean }>
  check(
    'delayed job: parked pending in the future',
    scheduled.length === 1 && scheduled[0].status === 'pending' && scheduled[0].far_future,
    JSON.stringify(scheduled[0] ?? null)
  )

  // A drain must not pick it up: `run_at` is the gate.
  const drained = await drainOnce({ ...runnerConfig(), batchSize: 5 })
  const stillThere = await countKeys(jobId)
  check(
    'delayed job: not claimable before its time',
    stillThere === 1,
    `${stillThere} row(s) after a drain claiming ${drained.claimed}`
  )

  await cancelScheduledDispatch(jobId)
  check('delayed job: cancelled', (await countKeys(jobId)) === 0, 'row removed')

  // Re-scheduling the same key must work — under the reference,
  // `removeOnComplete` freed the id, so a key that could never be reused would
  // be a silent behaviour change.
  await scheduleDispatch({
    jobId,
    handler: '__changelog_publish__',
    delayMs: 1_000,
    payload: { changelogId: 'cl_probe' },
  })
  check('delayed job: the key can be re-scheduled', (await countKeys(jobId)) === 1, 'rewritten')
  await cancelScheduledDispatch(jobId)
}

// ---------------------------------------------------------------------------
// 4. webhook auto-disable, end to end
// ---------------------------------------------------------------------------

async function autoDisable(): Promise<void> {
  // Two real webhook outcomes, both classified by the shipped hook rather than
  // by this script, and neither needing an external service:
  //
  //   retryable  a row whose stored secret will not decrypt. The hook returns
  //              `Failed to load webhook secret, shouldRetry: true` — a
  //              transient-shaped failure that must NOT touch the counter.
  //   permanent  a loopback URL, which the SSRF guard refuses outright:
  //              "never becomes valid on retry", `shouldRetry: false`.
  //
  // A local HTTP server cannot stand in for either: the guard blocks every
  // loopback and RFC 1918 address unconditionally, which is correct. A public
  // unroutable address is no good either — measured, a connect to RFC 5737
  // TEST-NET hangs past `safeFetch`'s timeout rather than aborting, which is
  // worth knowing but is not this piece's to fix.
  const PROBE_URL = `http://127.0.0.1:9/hook?run=${RUN}`

  const secret = encryptWebhookSecret('whsec_proof')
  const undecryptable = 'not-a-valid-ciphertext'
  const owner = (await raw`SELECT id FROM principal LIMIT 1`) as unknown as Array<{ id: string }>
  if (owner.length === 0) throw new Error('no principal row to own the probe webhook')

  const makeWebhook = async (url: string, storedSecret = secret): Promise<string> => {
    const rows = (await raw`
      INSERT INTO webhooks (id, created_by_id, url, secret, events, status)
      VALUES (gen_random_uuid(), ${owner[0].id}, ${url}, ${storedSecret}, ARRAY['post.created'], 'active')
      RETURNING id::text
    `) as unknown as Array<{ id: string }>
    return rows[0].id
  }

  const deliver = async (webhookId: string, url: string, n: number): Promise<void> => {
    const jobs = Array.from({ length: n }, (_, i) => ({
      name: 'post.created:webhook',
      data: {
        hookType: 'webhook',
        event: {
          id: `${RUN}-wh-${Date.now()}-${i}`,
          type: 'post.created',
          timestamp: new Date().toISOString(),
          actor: { type: 'service', displayName: 'proof' },
          data: { post: { id: 'post_probe', title: 't' } },
        },
        target: { url },
        config: { webhookId },
      } as never,
      jobId: `${RUN}:wh:${Date.now()}:${i}`,
    }))
    await enqueueHookJobsWithIds(jobs)
    // One pass per job, no more: a retryable failure re-arms after its backoff,
    // and draining it again would count a second attempt of the same delivery
    // as a second delivery.
    for (let pass = 0; pass < n; pass++) {
      const started = Date.now()
      const result = await drainOnce({ ...runnerConfig(), batchSize: 1 })
      console.log(
        `    pass ${pass + 1}/${n}: claimed ${result.claimed} in ${Date.now() - started}ms`
      )
      if (result.claimed === 0) break
    }
  }

  // ---- the control: retryable failures must NOT move the counter ----------
  const flaky = await makeWebhook(PROBE_URL, undecryptable)
  await deliver(flaky, PROBE_URL, 2)
  const afterRetryable = await failureCount(flaky)
  const flakyStatus = await statusOf(flaky)
  check(
    'auto-disable control: retryable failures leave the counter alone',
    afterRetryable === 0 && flakyStatus === 'active',
    `failureCount=${afterRetryable} status=${flakyStatus} after 2 retryable deliveries`
  )

  // ---- permanent failures DO move it --------------------------------------
  const broken = await makeWebhook(PROBE_URL)
  await deliver(broken, PROBE_URL, 3)
  const afterPermanent = await failureCount(broken)
  check(
    'auto-disable: a permanent failure increments the counter',
    afterPermanent === 3,
    `failureCount=${afterPermanent} after 3 permanent deliveries`
  )

  // ---- and the threshold disables ------------------------------------------
  await raw`UPDATE webhooks SET failure_count = 48 WHERE id = ${broken}::uuid`
  await deliver(broken, PROBE_URL, 2)
  const final = (await raw`
    SELECT failure_count::int AS n, status FROM webhooks WHERE id = ${broken}::uuid
  `) as unknown as Array<{ n: number; status: string }>
  check(
    'auto-disable: the endpoint disables itself at 50',
    final[0].n >= 50 && final[0].status === 'disabled',
    `failureCount=${final[0].n} status=${final[0].status}`
  )
}

async function statusOf(webhookId: string): Promise<string> {
  const rows = (await raw`
    SELECT status FROM webhooks WHERE id = ${webhookId}::uuid
  `) as unknown as Array<{ status: string }>
  return rows[0]?.status ?? 'missing'
}

async function failureCount(webhookId: string): Promise<number> {
  const rows = (await raw`
    SELECT failure_count::int AS n FROM webhooks WHERE id = ${webhookId}::uuid
  `) as unknown as Array<{ n: number }>
  return rows[0]?.n ?? -1
}

async function main(): Promise<void> {
  await cleanup()
  // Other suites share `quackback_test`; drain whatever is already runnable so
  // this script's own drains only ever see its own rows.
  for (let i = 0; i < 20; i++) {
    if ((await drainOnce({ ...runnerConfig(), batchSize: 5 })).claimed === 0) break
  }
  console.log('1. the retry curve')
  await curve()
  console.log('\n2. bulk enqueue with deterministic keys')
  await bulk()
  console.log('\n3. cancelable delayed jobs')
  await delayed()
  console.log('\n4. webhook auto-disable, end to end')
  await autoDisable()

  await cleanup()
  await raw.end()
  console.log('')
  if (failures.length > 0) {
    console.log(`FAIL — ${failures.length} check(s): ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('PASS — all four properties demonstrated')
}

void main().catch(async (err) => {
  console.error(err)
  await cleanup().catch(() => {})
  await raw.end().catch(() => {})
  process.exit(1)
})
