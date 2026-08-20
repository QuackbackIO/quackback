/**
 * Workflow run retention — a daily job that compacts old terminal workflow
 * runs' `graph` snapshots (see workflow-retention.ts).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { compactTerminalWorkflowRuns } from './workflow-retention'

const log = logger.child({ component: 'workflow-retention' })

export async function runWorkflowRetention(): Promise<void> {
  const result = await compactTerminalWorkflowRuns()
  if (result.compacted > 0) {
    log.debug({ compacted: result.compacted }, 'workflow-retention run complete')
  }
}
