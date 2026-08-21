/**
 * Workflow run sweeper — a five-minute job that reconciles runs stranded
 * outside a durable wait boundary (see sweepWorkflowRuns): a crashed process's
 * stale 'running' rows, and 'waiting' rows whose durable timer went missing.
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`. The sweep module is imported statically so
 * `primeJobHandlers()` loads it outside any workspace scope — see
 * sla-breach-sweep-queue.ts for why that matters.
 */
import { sweepWorkflowRuns } from './workflow-sweep'

export async function runWorkflowSweep(): Promise<void> {
  await sweepWorkflowRuns()
}
