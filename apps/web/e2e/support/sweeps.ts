/**
 * Run one background sweep now through the test-only endpoint
 * (/api/e2e/sweep, src/lib/server/e2e-harness/sweeps.ts), optionally as of a
 * later time, so SLA, snooze and workflow timers need no real wait.
 *
 *   await runSweep(request, 'snooze-sweep', { asOf: minutesFromNow(61) })
 *
 * Sweeps with an "as of" clock: sla-breach-sweep, snooze-sweep, workflow-sweep,
 * workflow-wait (promotes delayed workflow jobs due by then). Wall clock only:
 * email-log-retention, workflow-retention, spam-retention, anon-sweep.
 */
import { expect, type APIRequestContext } from '@playwright/test'

export type SweepName =
  | 'sla-breach-sweep'
  | 'snooze-sweep'
  | 'workflow-sweep'
  | 'workflow-wait'
  | 'email-log-retention'
  | 'workflow-retention'
  | 'spam-retention'
  | 'anon-sweep'

export interface SweepRun {
  ok: true
  job: SweepName
  asOf: string
  result: Record<string, unknown>
}

export async function runSweep(
  request: APIRequestContext,
  job: SweepName,
  opts: { asOf?: Date } = {}
): Promise<SweepRun> {
  const res = await request.post('/api/e2e/sweep', {
    data: { job, ...(opts.asOf ? { asOf: opts.asOf.toISOString() } : {}) },
  })
  expect(res.status(), `sweep ${job}: ${await res.text()}`).toBe(200)
  return (await res.json()) as SweepRun
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000)
}
