import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import { runIntegrationSync } from './sync/worker'

export async function handleSlackHookJob(job: ClaimedJob): Promise<void> {
  if (typeof job.payload.operationId !== 'string')
    throw new TerminalJobError('Slack delivery requires a sync operation')
  return runIntegrationSync(job)
}
