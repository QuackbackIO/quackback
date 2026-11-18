/**
 * The e2e sweep runner: run one background sweep now, optionally "as of" a
 * later instant, so a test of an SLA breach, a snooze wake or a workflow timer
 * does not wait for the wall clock.
 *
 * Reached only through `/api/e2e/sweep`, behind the harness gate
 * (`./gate.ts`). The allow-list below is the whole surface: a name that is not
 * in it is refused, and so is an `asOf` for a sweep that cannot honour one
 * (rather than silently running it at the wall clock).
 *
 * The sweeps are called directly, not through the queue: the cron gate
 * (`cronEnabled`) and the lease machinery are the queue's business, and a test
 * that asks for a pass wants the pass. `workflow-wait` is the exception: its
 * timers are delayed queue rows, so "as of" means promoting every row due by
 * then to run now and waking the worker, which then runs them for real.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'e2e-sweep-runner' })

interface SweepEntry {
  /** Whether the sweep can run against a clock other than the wall clock. */
  asOf: boolean
  run: (at: Date) => Promise<Record<string, unknown>>
}

const SWEEPS: Record<string, SweepEntry> = {
  'sla-breach-sweep': {
    asOf: true,
    run: async (at) => {
      const { runSlaBreachSweepAt } =
        await import('@/lib/server/domains/sla/sla-breach-sweep-queue')
      return runSlaBreachSweepAt(at)
    },
  },
  'snooze-sweep': {
    asOf: true,
    run: async (at) => {
      const { runSnoozeSweepAt } =
        await import('@/lib/server/domains/conversation/snooze-sweep-queue')
      return runSnoozeSweepAt(at)
    },
  },
  'workflow-sweep': {
    asOf: true,
    run: async (at) => {
      const { runWorkflowSweepAt } =
        await import('@/lib/server/domains/workflows/workflow-sweep-queue')
      await runWorkflowSweepAt(at)
      return {}
    },
  },
  'workflow-wait': {
    asOf: true,
    run: (at) => promoteDueJobs('workflow-wait', at),
  },
  'email-log-retention': {
    asOf: false,
    run: async () => {
      const { runEmailLogRetention } = await import('@/lib/server/email/email-log.retention')
      await runEmailLogRetention()
      return {}
    },
  },
  'workflow-retention': {
    asOf: false,
    run: async () => {
      const { runWorkflowRetention } =
        await import('@/lib/server/domains/workflows/workflow-retention-queue')
      await runWorkflowRetention()
      return {}
    },
  },
  'spam-retention': {
    asOf: false,
    run: async () => {
      const { runSpamRetention } =
        await import('@/lib/server/domains/conversation/spam-retention-queue')
      await runSpamRetention()
      return {}
    },
  },
  'anon-sweep': {
    asOf: false,
    run: async () => {
      const { runAnonSweep } = await import('@/lib/server/domains/principals/anon-sweep-queue')
      await runAnonSweep()
      return {}
    },
  },
}

/** The sweeps the runner accepts, for the refusal message and the tests. */
export const E2E_SWEEP_NAMES: readonly string[] = Object.keys(SWEEPS)

/**
 * Make every pending row of `queue` that is due by `at` due now, then wake the
 * worker so it claims them at once instead of at its next poll.
 */
async function promoteDueJobs(queue: string, at: Date): Promise<Record<string, unknown>> {
  const result = await db.execute(sql`
    UPDATE job_queue SET run_at = now(), updated_at = now()
    WHERE queue = ${queue} AND status = 'pending' AND run_at <= ${at.toISOString()}::timestamptz
    RETURNING job_id, workspace_key
  `)
  const rows = getExecuteRows<{ job_id: string; workspace_key: string | null }>(result)
  if (rows.length > 0) {
    const { wakeWorkspace } = await import('@/lib/server/jobs')
    const byWorkspace = new Map<string, string[]>()
    for (const row of rows) {
      const key = row.workspace_key ?? ''
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), row.job_id])
    }
    for (const [key, ids] of byWorkspace) await wakeWorkspace(key, ids)
  }
  return { promoted: rows.length }
}

export type E2eSweepRequest = { job: string; asOf?: string }

export type E2eSweepResult =
  | { ok: true; job: string; asOf: string; result: Record<string, unknown> }
  | { ok: false; status: 400; error: string }

/** Validate a request body and run the sweep it names. */
export async function runE2eSweep(body: unknown): Promise<E2eSweepResult> {
  const input = (body ?? {}) as { job?: unknown; asOf?: unknown }
  const job = typeof input.job === 'string' ? input.job : ''
  const entry = Object.hasOwn(SWEEPS, job) ? SWEEPS[job] : undefined
  if (!entry) {
    return {
      ok: false,
      status: 400,
      error: `Unknown sweep "${job}". Known: ${E2E_SWEEP_NAMES.join(', ')}`,
    }
  }

  let at = new Date()
  if (input.asOf !== undefined && input.asOf !== null) {
    if (!entry.asOf) {
      return { ok: false, status: 400, error: `Sweep "${job}" cannot run as of another time` }
    }
    const parsed = typeof input.asOf === 'string' ? new Date(input.asOf) : new Date(NaN)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, error: 'asOf must be an ISO-8601 timestamp' }
    }
    at = parsed
  }

  log.info({ job, as_of: at.toISOString() }, 'e2e sweep run')
  const result = await entry.run(at)
  return { ok: true, job, asOf: at.toISOString(), result }
}
